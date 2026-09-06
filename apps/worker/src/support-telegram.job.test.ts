import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { processSupportTelegram } from "./support-telegram.job.js";

const originalToken = process.env.TELEGRAM_SUPPORT_BOT_TOKEN;
const originalChat = process.env.TELEGRAM_SUPPORT_CHAT_ID;

function supportRow(status = "PENDING") {
  return {
    id: "ab12cd34-0000-4000-8000-000000000000",
    workspaceId: "workspace-a",
    category: "SUGGESTION",
    message: "Use <b>only</b> & keep it safe.",
    sourceRoute: "https://mcp.holymedia.kz/dashboard/reports",
    locale: "ru",
    planKey: "legacy_internal",
    createdAt: new Date("2026-08-29T08:00:00Z"),
    telegramDeliveryStatus: status,
    telegramMessageId: status === "SENT" ? "77" : (null as string | null),
    user: { name: "Test User", email: "test@example.com" },
    workspace: { name: "Test Workspace" },
  };
}

function databaseFor(row = supportRow()) {
  const updates: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  return {
    updates,
    audits,
    database: {
      client: {
        supportRequest: {
          findFirst: async () => row,
          updateMany: async (value: Record<string, unknown>) => {
            const where = value.where as {
              telegramDeliveryStatus?: string | { in: string[] };
              telegramMessageId?: null;
            };
            const expected = where.telegramDeliveryStatus;
            if (
              (where.telegramMessageId === null && row.telegramMessageId) ||
              (typeof expected === "string" &&
                row.telegramDeliveryStatus !== expected) ||
              (typeof expected === "object" &&
                !expected.in.includes(row.telegramDeliveryStatus))
            )
              return { count: 0 };
            updates.push(value);
            Object.assign(row, value.data);
            return { count: 1 };
          },
        },
        auditEvent: {
          create: async (value: Record<string, unknown>) => {
            audits.push(value);
            return value;
          },
        },
      },
    } as never,
  };
}

function job() {
  return {
    data: {
      supportRequestId: "ab12cd34-0000-4000-8000-000000000000",
      workspaceId: "workspace-a",
    },
    attemptsMade: 0,
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined)
    delete process.env.TELEGRAM_SUPPORT_BOT_TOKEN;
  else process.env.TELEGRAM_SUPPORT_BOT_TOKEN = originalToken;
  if (originalChat === undefined) delete process.env.TELEGRAM_SUPPORT_CHAT_ID;
  else process.env.TELEGRAM_SUPPORT_CHAT_ID = originalChat;
});

describe("support Telegram delivery", () => {
  it("integrates with a fake HTTP Telegram upstream without real messages", async () => {
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN = "vitest-telegram-token-000000";
    process.env.TELEGRAM_SUPPORT_CHAT_ID = "123";
    let sends = 0;
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        sends++;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, result: { message_id: 88 } }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const realFetch = globalThis.fetch;
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubGlobal("fetch", (_url: unknown, init: RequestInit) =>
      realFetch(endpoint, init),
    );
    try {
      const h = databaseFor();
      await expect(
        processSupportTelegram(h.database, job()),
      ).resolves.toMatchObject({ telegramMessageId: "88" });
      await processSupportTelegram(h.database, job());
      expect(sends).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("audit failure after success never downgrades or resends", async () => {
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN = "vitest-telegram-token-000000";
    process.env.TELEGRAM_SUPPORT_CHAT_ID = "123";
    const row = supportRow();
    const h = databaseFor(row);
    const db = h.database as unknown as {
      client: { auditEvent: { create: () => Promise<unknown> } };
    };
    db.client.auditEvent.create = async () => {
      throw new Error("audit unavailable");
    };
    const send = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })),
      );
    vi.stubGlobal("fetch", send);
    await expect(
      processSupportTelegram(h.database, job()),
    ).resolves.toMatchObject({ delivered: true });
    expect(row.telegramDeliveryStatus).toBe("SENT");
    await expect(
      processSupportTelegram(h.database, job()),
    ).resolves.toMatchObject({ delivered: true, telegramMessageId: "77" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("concurrent executions atomically claim one send", async () => {
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN = "vitest-telegram-token-000000";
    process.env.TELEGRAM_SUPPORT_CHAT_ID = "123";
    const h = databaseFor();
    const send = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 77 } }),
      );
    });
    vi.stubGlobal("fetch", send);
    await Promise.all([
      processSupportTelegram(h.database, job()),
      processSupportTelegram(h.database, job()),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("network uncertainty is not retried as a fresh Telegram send", async () => {
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN = "vitest-telegram-token-000000";
    process.env.TELEGRAM_SUPPORT_CHAT_ID = "123";
    const row = supportRow();
    const h = databaseFor(row);
    const send = vi
      .fn()
      .mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    vi.stubGlobal("fetch", send);
    await expect(
      processSupportTelegram(h.database, job()),
    ).resolves.toMatchObject({ status: "uncertain" });
    expect(row.telegramDeliveryStatus).toBe("UNCERTAIN");
    await processSupportTelegram(h.database, job());
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("sends an escaped notification and marks the request as delivered", async () => {
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN = "vitest-telegram-token-000000";
    process.env.TELEGRAM_SUPPORT_CHAT_ID = "-1001234567890";
    const { database, updates, audits } = databaseFor();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(processSupportTelegram(database, job())).resolves.toEqual({
      delivered: true,
      telegramMessageId: "77",
    });
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body));
    expect(payload.text).toContain(
      "&lt;b&gt;only&lt;/b&gt; &amp; keep it safe.",
    );
    expect(payload.text).toContain(
      "Полный доступ / Бессрочно / Full access / Lifetime",
    );
    expect(payload.text).not.toContain("legacy_internal");
    expect(payload.text).toContain(
      "https://mcp.holymedia.kz/dashboard/reports",
    );
    expect(payload.reply_markup.inline_keyboard[0][0].url).toMatch(
      /\/admin\?section=support/,
    );
    expect(updates.at(-1)?.data).toMatchObject({
      telegramDeliveryStatus: "SENT",
      telegramMessageId: "77",
    });
    expect(audits.at(-1)?.data).toMatchObject({
      eventType: "support_telegram_delivered",
    });
  });

  it("records a delivery error and rethrows so BullMQ retries it", async () => {
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN = "vitest-telegram-token-000000";
    process.env.TELEGRAM_SUPPORT_CHAT_ID = "-1001234567890";
    const { database, updates, audits } = databaseFor();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: false }), { status: 500 }),
        ),
    );

    await expect(processSupportTelegram(database, job())).rejects.toThrow(
      "Telegram delivery failed",
    );
    expect(updates.at(-1)?.data).toMatchObject({
      telegramDeliveryStatus: "FAILED",
      telegramLastErrorCode: "HTTP_500",
    });
    expect(audits.at(-1)?.data).toMatchObject({
      eventType: "support_telegram_delivery_failed",
      success: false,
    });
  });

  it("does not confirm delivery without a Telegram message ID", async () => {
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN = "vitest-telegram-token-000000";
    process.env.TELEGRAM_SUPPORT_CHAT_ID = "-1001234567890";
    const { database, updates } = databaseFor();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true, result: {} })),
        ),
    );

    await expect(
      processSupportTelegram(database, job()),
    ).resolves.toMatchObject({ delivered: false, status: "uncertain" });
    expect(updates.at(-1)?.data).toMatchObject({
      telegramDeliveryStatus: "UNCERTAIN",
    });
  });

  it("does not send a duplicate notification after successful delivery", async () => {
    const { database } = databaseFor(supportRow("SENT"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(processSupportTelegram(database, job())).resolves.toEqual({
      delivered: true,
      telegramMessageId: "77",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
