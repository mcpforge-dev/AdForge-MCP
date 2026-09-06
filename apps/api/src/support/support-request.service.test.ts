import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import { describe, expect, it } from "vitest";
import { RateLimitExceededError } from "../infrastructure/redis-rate-limit.service.js";
import { SupportRequestService } from "./support-request.service.js";

const request = {
  user: { kind: "human" as const, userId: "user-a", sessionId: "session-a" },
  ip: "203.0.113.10",
  headers: {},
  requestId: "request-a",
};

function input(message = "The account selector needs more space on mobile.") {
  return {
    category: "SUGGESTION" as const,
    message,
    sourceRoute: "/dashboard/reports",
    locale: "ru" as const,
    idempotencyKey: "idempotency-key-0001",
  };
}

describe("SupportRequestService", () => {
  it("persists identity and workspace only from server context", async () => {
    let createInput: Record<string, unknown> | undefined;
    const database = {
      client: {
        supportRequest: {
          findFirst: async () => null,
          create: async (value: Record<string, unknown>) => {
            createInput = value;
            return {
              id: "support-a",
              status: "NEW",
              createdAt: new Date("2026-08-29T08:00:00Z"),
            };
          },
        },
        workspace: {
          findUnique: async () => ({
            accessStatus: "ACTIVE",
            subscriptions: [{ plan: { key: "ai_marketing" } }],
          }),
        },
      },
    } as never;
    const auditEvents: Record<string, unknown>[] = [];
    const limits: string[] = [];
    const service = new SupportRequestService(
      database,
      {
        record: async (event: Record<string, unknown>) =>
          auditEvents.push(event),
      } as never,
      {
        consume: async (key: string) => {
          limits.push(key);
        },
      } as never,
    );

    await expect(
      service.create("workspace-a", input(), request),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(createInput?.data).toMatchObject({
      workspaceId: "workspace-a",
      userId: "user-a",
      category: "SUGGESTION",
      planKey: "ai_marketing",
      telegramDeliveryStatus: "NOT_CONFIGURED",
      sourceRoute: new URL(
        "/dashboard/reports",
        loadConfig().publicBaseUrl,
      ).toString(),
    });
    expect(auditEvents[0]).toMatchObject({
      targetType: "support_request",
      actorUserId: "user-a",
      workspaceId: "workspace-a",
    });
    expect(limits).toEqual(
      expect.arrayContaining([
        "support:user:user-a",
        "support:workspace:workspace-a",
      ]),
    );
  });

  it("deduplicates a retried request within its authenticated workspace", async () => {
    const database = {
      client: {
        supportRequest: {
          findFirst: async () => ({
            id: "support-existing",
            category: input().category,
            message: input().message,
            sourceRoute: new URL(
              input().sourceRoute,
              loadConfig().publicBaseUrl,
            ).toString(),
            locale: "ru",
            status: "NEW",
            createdAt: new Date(),
            telegramDeliveryStatus: "SENT",
            telegramMessageId: "77",
          }),
          create: async () => {
            throw new Error("must not create");
          },
        },
      },
    } as never;
    const service = new SupportRequestService(
      database,
      { record: async () => undefined } as never,
      { consume: async () => undefined } as never,
    );

    await expect(
      service.create("workspace-a", input(), request),
    ).resolves.toMatchObject({
      created: false,
      telegramDelivered: true,
      telegramMessageId: "77",
      request: { id: "support-existing" },
    });
  });

  it("does not persist an arbitrary external page in a support request", async () => {
    let createInput: Record<string, unknown> | undefined;
    const service = new SupportRequestService(
      {
        client: {
          supportRequest: {
            findFirst: async () => null,
            create: async (value: Record<string, unknown>) => {
              createInput = value;
              return { id: "support-a", status: "NEW", createdAt: new Date() };
            },
          },
          workspace: {
            findUnique: async () => ({
              accessStatus: "ACTIVE",
              subscriptions: [],
            }),
          },
        },
      } as never,
      { record: async () => undefined } as never,
      { consume: async () => undefined } as never,
    );

    await expect(
      service.create(
        "workspace-a",
        {
          ...input(),
          sourceRoute: "https://attacker.example/dashboard/reports",
        },
        request,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(createInput?.data).toMatchObject({ sourceRoute: null });
  });

  it("rejects an empty or whitespace-only message", async () => {
    const service = new SupportRequestService(
      { client: {} } as never,
      { record: async () => undefined } as never,
      { consume: async () => undefined } as never,
    );
    await expect(
      service.create("workspace-a", input("  \n  "), request),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not create a request after a server-side rate limit", async () => {
    let createCalls = 0;
    const service = new SupportRequestService(
      {
        client: {
          supportRequest: {
            findFirst: async () => null,
            create: async () => createCalls++,
          },
        },
      } as never,
      { record: async () => undefined } as never,
      {
        consume: async () => {
          throw new RateLimitExceededError();
        },
      } as never,
    );
    await expect(
      service.create("workspace-a", input(), request),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(createCalls).toBe(0);
  });
});
