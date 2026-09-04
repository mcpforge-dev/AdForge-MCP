import { describe, expect, it } from "vitest";
import {
  FULL_ACCESS_LIFETIME_GRANT,
  FULL_ACCESS_LIFETIME_PLAN_KEY,
} from "@holymedia/contracts";
import { AdminService } from "./admin.service.js";

const request = { headers: {} };

describe("Admin full lifetime access", () => {
  it("assigns the internal full-access preset, activates the company and writes an audit event", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const auditEvents: Array<Record<string, unknown>> = [];
    const database = {
      client: {
        workspace: {
          findUnique: async () => ({
            id: "workspace-a",
            accessStatus: "PENDING",
            subscriptions: [{ plan: { key: "ai_ads_self" } }],
          }),
        },
        plan: {
          findUnique: async () => ({
            id: "legacy-plan",
            key: FULL_ACCESS_LIFETIME_PLAN_KEY,
          }),
        },
        $transaction: async (operation: (client: unknown) => Promise<void>) =>
          operation({
            workspace: {
              update: async (input: Record<string, unknown>) =>
                writes.push(input),
            },
            workspaceSubscription: {
              updateMany: async (input: Record<string, unknown>) =>
                writes.push(input),
              create: async (input: Record<string, unknown>) =>
                writes.push(input),
            },
          }),
      },
    } as never;
    const audit = {
      record: async (event: Record<string, unknown>) => auditEvents.push(event),
    };
    const service = new AdminService(
      database,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.assignFullLifetimeAccess("workspace-a", request as never),
    ).resolves.toMatchObject({ access: "full_lifetime", expiresAt: null });

    expect(writes).toContainEqual(
      expect.objectContaining({ data: { accessStatus: "ACTIVE" } }),
    );
    expect(writes).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "workspace-a",
          planId: "legacy-plan",
          status: "ACTIVE",
          metadata: expect.objectContaining({
            accessGrant: FULL_ACCESS_LIFETIME_GRANT,
            paymentRequired: false,
          }),
        }),
      }),
    );
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        eventType: "admin_full_access_assigned",
        workspaceId: "workspace-a",
        metadata: expect.objectContaining({
          previousAccess: "ai_ads_self",
          newAccess: FULL_ACCESS_LIFETIME_PLAN_KEY,
        }),
      }),
    );
  });

  it("does not make the internal preset available through commercial plan assignment", async () => {
    const service = new AdminService(
      { client: {} } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.setPlan(
        "workspace-a",
        { planKey: FULL_ACCESS_LIFETIME_PLAN_KEY, mode: "ACTIVE" },
        request as never,
      ),
    ).rejects.toThrow("Plan is not available.");
  });

  it("replaces full lifetime access with a normal commercial subscription", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const auditEvents: Array<Record<string, unknown>> = [];
    const database = {
      client: {
        plan: {
          findUnique: async () => ({
            id: "commercial-plan",
            key: "ai_ads_self",
            name: "AI Ads",
            active: true,
            prices: [{ id: "commercial-price" }],
          }),
        },
        workspace: {
          findUnique: async () => ({
            id: "workspace-a",
            subscriptions: [{ plan: { key: FULL_ACCESS_LIFETIME_PLAN_KEY } }],
          }),
        },
        $transaction: async (operation: (client: unknown) => Promise<void>) =>
          operation({
            workspaceSubscription: {
              updateMany: async (input: Record<string, unknown>) =>
                writes.push(input),
              create: async (input: Record<string, unknown>) =>
                writes.push(input),
            },
          }),
      },
    } as never;
    const audit = {
      record: async (event: Record<string, unknown>) => auditEvents.push(event),
    };
    const service = new AdminService(
      database,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.setPlan(
      "workspace-a",
      { planKey: "ai_ads_self", mode: "ACTIVE" },
      request as never,
    );

    expect(writes).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELED" }),
      }),
    );
    expect(writes).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          planId: "commercial-plan",
          priceId: "commercial-price",
          status: "ACTIVE",
        }),
      }),
    );
    expect(auditEvents[0]).toMatchObject({
      eventType: "admin_plan_assigned",
      metadata: expect.objectContaining({
        previousAccess: FULL_ACCESS_LIFETIME_PLAN_KEY,
        newAccess: "ai_ads_self",
      }),
    });
  });

  it("removes only an active full-access subscription and audits the change", async () => {
    let update: Record<string, unknown> | undefined;
    const auditEvents: Array<Record<string, unknown>> = [];
    const database = {
      client: {
        workspaceSubscription: {
          findFirst: async () => ({
            id: "subscription-a",
            plan: { key: FULL_ACCESS_LIFETIME_PLAN_KEY },
          }),
          update: async (input: Record<string, unknown>) => {
            update = input;
            return {};
          },
        },
      },
    } as never;
    const audit = {
      record: async (event: Record<string, unknown>) => auditEvents.push(event),
    };
    const service = new AdminService(
      database,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.removeFullLifetimeAccess("workspace-a", request as never),
    ).resolves.toMatchObject({ access: "none" });
    expect(update).toMatchObject({
      where: { id: "subscription-a" },
      data: { status: "CANCELED" },
    });
    expect(auditEvents[0]).toMatchObject({
      eventType: "admin_full_access_removed",
      workspaceId: "workspace-a",
    });
  });
});
