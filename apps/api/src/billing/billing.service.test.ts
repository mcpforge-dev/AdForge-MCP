import { describe, expect, it } from "vitest";
import { BillingService } from "./billing.service.js";

describe("Billing usage", () => {
  it("creates a workspace-scoped tariff request without assigning access", async () => {
    let created: Record<string, unknown> | undefined;
    const database = {
      client: {
        plan: {
          findUnique: async () => ({
            id: "plan-ads-support",
            key: "ai_ads_support",
            name: "AI Ads + Holy Media support",
            active: true,
          }),
        },
        tariffRequest: {
          findFirst: async () => null,
          create: async (input: Record<string, unknown>) => {
            created = input;
            return {
              id: "request-a",
              requestedPlan: { key: "ai_ads_support" },
            };
          },
        },
      },
    } as never;
    const service = new BillingService(database);
    await expect(
      service.createTariffRequest("workspace-a", "ai_ads_support", {
        user: { kind: "human", userId: "user-a", sessionId: "session-a" },
        headers: {},
      }),
    ).resolves.toMatchObject({ created: true });
    expect(created?.data).toMatchObject({
      workspaceId: "workspace-a",
      userId: "user-a",
      requestedPlanId: "plan-ads-support",
      requestedServiceLevel: "HOLYMEDIA_SUPPORT",
    });
  });

  it("deduplicates the same pending tariff request in one workspace", async () => {
    let createCalls = 0;
    const database = {
      client: {
        plan: {
          findUnique: async () => ({
            id: "plan-ads-self",
            key: "ai_ads_self",
            name: "AI Ads",
            active: true,
          }),
        },
        tariffRequest: {
          findFirst: async () => ({
            id: "request-existing",
            requestedPlan: { key: "ai_ads_self" },
          }),
          create: async () => createCalls++,
        },
      },
    } as never;
    const service = new BillingService(database);
    await expect(
      service.createTariffRequest("workspace-a", "ai_ads_self", {
        user: { kind: "human", userId: "user-a", sessionId: "session-a" },
        headers: {},
      }),
    ).resolves.toMatchObject({ created: false });
    expect(createCalls).toBe(0);
  });

  it("records monthly MCP usage without sensitive metadata", async () => {
    let input: Record<string, unknown> | undefined;
    const database = {
      client: {
        usageRecord: {
          upsert: async (value: Record<string, unknown>) => {
            input = value;
            return value;
          },
        },
      },
    } as never;
    const service = new BillingService(database);
    await service.recordUsage("workspace-a", "mcp.requests");
    expect(input).toBeDefined();
    expect(JSON.stringify(input)).not.toMatch(/token|authorization|cookie/i);
    expect(input?.update).toEqual({ quantity: { increment: 1 } });
  });

  it("ignores unsafe metric keys", async () => {
    let calls = 0;
    const database = {
      client: { usageRecord: { upsert: async () => calls++ } },
    } as never;
    const service = new BillingService(database);
    await service.recordUsage("workspace-a", "oauth_access_token");
    expect(calls).toBe(0);
  });

  it("atomically rejects an MCP request beyond the plan limit", async () => {
    const database = {
      client: {
        entitlement: { findMany: async () => [] },
        workspaceSubscription: { findFirst: async () => null },
        plan: {
          findUnique: async () => ({
            features: { mcp: true, monthly_mcp_requests: 500 },
          }),
        },
        $transaction: async (operation: (client: unknown) => Promise<void>) =>
          operation({
            usageRecord: {
              upsert: async () => ({ quantity: 501 }),
            },
          }),
      },
    } as never;
    const service = new BillingService(database);
    await expect(service.consumeMcpRequest("workspace-a")).rejects.toThrow(
      "Workspace usage limit reached.",
    );
  });

  it("keeps migrated legacy workspaces unlimited", async () => {
    let usageRecorded = 0;
    const database = {
      client: {
        entitlement: {
          findMany: async () => [{ featureKey: "legacy_access", value: true }],
        },
        workspaceSubscription: { findFirst: async () => null },
        plan: { findUnique: async () => null },
        usageRecord: { upsert: async () => usageRecorded++ },
      },
    } as never;
    const service = new BillingService(database);
    await service.consumeMcpRequest("workspace-a");
    expect(usageRecorded).toBe(1);
  });

  it("enforces the provider account limit before enabling another account", async () => {
    const database = {
      client: {
        entitlement: { findMany: async () => [] },
        workspaceSubscription: { findFirst: async () => null },
        plan: {
          findUnique: async () => ({ features: { provider_accounts: 1 } }),
        },
        $transaction: async (operation: (client: unknown) => Promise<void>) =>
          operation({
            providerAccount: {
              findFirst: async () => ({ enabled: false }),
              count: async () => 1,
            },
          }),
      },
    } as never;
    const service = new BillingService(database);
    await expect(
      service.setProviderAccountEnabled("workspace-a", "account-b", true),
    ).rejects.toThrow("Provider account limit reached.");
  });

  it("atomically replaces one connection selection", async () => {
    const accounts = [
      { id: "account-a", enabled: true },
      { id: "account-b", enabled: true },
      { id: "account-c", enabled: true },
    ];
    const database = {
      client: {
        entitlement: {
          findMany: async () => [{ featureKey: "legacy_access", value: true }],
        },
        workspaceSubscription: { findFirst: async () => null },
        $transaction: async (
          operation: (client: unknown) => Promise<unknown>,
        ) =>
          operation({
            providerAccount: {
              findMany: async () =>
                accounts.map(({ id, enabled }) => ({ id, enabled })),
              count: async () => 0,
              updateMany: async (input: { data: { enabled: boolean } }) => {
                for (const account of accounts) {
                  account.enabled = input.data.enabled
                    ? account.id === "account-b"
                    : false;
                }
                return { count: accounts.length };
              },
            },
          }),
      },
    } as never;
    const service = new BillingService(database);

    await expect(
      service.setProviderAccountsEnabled("workspace-a", "connection-a", [
        "account-b",
      ]),
    ).resolves.toEqual({ changedAccountIds: ["account-a", "account-c"] });
    expect(accounts.map((account) => [account.id, account.enabled])).toEqual([
      ["account-a", false],
      ["account-b", true],
      ["account-c", false],
    ]);
  });
});
