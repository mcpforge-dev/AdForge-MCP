import { afterEach, describe, expect, it, vi } from "vitest";
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
          update: async (value: Record<string, unknown>) => {
            updates.push(value);
            return value;
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
        .mockResolvedValue(new Response("fail", { status: 500 })),
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

    await expect(processSupportTelegram(database, job())).rejects.toThrow(
      "Telegram delivery failed",
    );
    expect(updates.at(-1)?.data).toMatchObject({
      telegramDeliveryStatus: "FAILED",
      telegramLastErrorCode: "MISSING_MESSAGE_ID",
    });
  });

  it("does not send a duplicate notification after successful delivery", async () => {
    const { database } = databaseFor(supportRow("SENT"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(processSupportTelegram(database, job())).resolves.toEqual({
      skipped: "sent",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
