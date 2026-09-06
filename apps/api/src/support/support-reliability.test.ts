import { ConflictException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { SupportRequestService } from "./support-request.service.js";

const queue = vi.hoisted(() => ({ wait: vi.fn() }));
vi.mock("bullmq", () => ({
  Queue: class {
    add() {
      return Promise.resolve({ waitUntilFinished: queue.wait });
    }
    close() {
      return Promise.resolve();
    }
  },
  QueueEvents: class {
    waitUntilReady() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const request = {
  user: { kind: "human" as const, userId: "user-a", sessionId: "session-a" },
  headers: {},
};
const input = (message = "A real support message") => ({
  category: "QUESTION" as const,
  message,
  sourceRoute: "/dashboard",
  locale: "ru" as const,
  idempotencyKey: "same-key-00000001",
});
type Row = ReturnType<typeof input> & {
  id: string;
  status: string;
  createdAt: Date;
  telegramMessageId: string | null;
  telegramDeliveryStatus: string;
};
function harness() {
  let row: Row | undefined;
  let inserts = 0;
  const db = {
    client: {
      supportRequest: {
        findFirst: async () => row,
        create: async ({ data }: { data: ReturnType<typeof input> }) => {
          // Both callers can pass the initial read; the database constraint picks one.
          await Promise.resolve();
          if (row)
            throw {
              code: "P2002",
              meta: { target: ["workspace_id", "user_id", "idempotency_key"] },
            };
          inserts++;
          row = {
            ...data,
            id: "request-a",
            status: "NEW",
            createdAt: new Date(),
            telegramMessageId: null,
            telegramDeliveryStatus: "PENDING",
          };
          return row;
        },
      },
      workspace: {
        findUnique: async () => ({ subscriptions: [], accessStatus: "ACTIVE" }),
      },
    },
  };
  const service = new SupportRequestService(
    db as never,
    { record: async () => undefined } as never,
    { consume: async () => undefined } as never,
  );
  return {
    service,
    db,
    row: () => row!,
    inserts: () => inserts,
    seed: () => {
      row = {
        ...input(),
        sourceRoute: new URL(
          "/dashboard",
          loadConfig().publicBaseUrl,
        ).toString(),
        id: "request-a",
        status: "NEW",
        createdAt: new Date(),
        telegramMessageId: "77",
        telegramDeliveryStatus: "SENT",
      };
    },
  };
}
function configured() {
  vi.stubEnv("TELEGRAM_SUPPORT_BOT_TOKEN", "vitest-telegram-token-000000");
  vi.stubEnv("TELEGRAM_SUPPORT_CHAT_ID", "123");
}

describe("support reliability", () => {
  it("same payload after SENT returns its confirmation without a new job", async () => {
    const h = harness();
    h.seed();
    expect(
      await h.service.create("workspace-a", input(), request),
    ).toMatchObject({ telegramMessageId: "77", created: false });
    expect(queue.wait).not.toHaveBeenCalled();
  });
  it("changed payload with the same key conflicts", async () => {
    const h = harness();
    h.seed();
    await expect(
      h.service.create("workspace-a", input("Changed message"), request),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it("parallel same payload creates one row and returns consistent delivery", async () => {
    configured();
    const h = harness();
    queue.wait.mockResolvedValue({ delivered: true, telegramMessageId: "77" });
    const results = await Promise.all([
      h.service.create("workspace-a", input(), request),
      h.service.create("workspace-a", input(), request),
    ]);
    expect(h.inserts()).toBe(1);
    for (const result of results)
      expect(result).toMatchObject({ telegramMessageId: "77" });
  });
  it("parallel different payload creates one row and one conflict", async () => {
    configured();
    const h = harness();
    queue.wait.mockResolvedValue({ delivered: true, telegramMessageId: "77" });
    const results = await Promise.allSettled([
      h.service.create("workspace-a", input(), request),
      h.service.create("workspace-a", input("Other content"), request),
    ]);
    expect(h.inserts()).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: expect.any(ConflictException),
    });
  });
  it("wait timeout rereads Worker success without downgrading SENT", async () => {
    configured();
    const h = harness();
    queue.wait.mockImplementation(async () => {
      h.row().telegramDeliveryStatus = "SENT";
      h.row().telegramMessageId = "77";
      throw new Error("wait timed out");
    });
    expect(
      await h.service.create("workspace-a", input(), request),
    ).toMatchObject({ telegramDelivered: true, telegramMessageId: "77" });
    expect(h.row().telegramDeliveryStatus).toBe("SENT");
  });
  it("does not swallow an unrelated unique violation", async () => {
    configured();
    const h = harness();
    h.db.client.supportRequest.create = async () => {
      throw { code: "P2002", meta: { target: ["id"] } };
    };
    await expect(
      h.service.create("workspace-a", input(), request),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
