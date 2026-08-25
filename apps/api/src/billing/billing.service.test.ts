import { describe, expect, it } from "vitest";
import { BillingService } from "./billing.service.js";

describe("Billing usage", () => {
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

  it("saves provider account selection in one transaction", async () => {
    const transactions: unknown[] = [];
    const updates: Record<string, unknown>[] = [];
    const database = {
      client: {
        entitlement: { findMany: async () => [] },
        workspaceSubscription: { findFirst: async () => null },
        plan: {
          findUnique: async () => ({ features: { provider_accounts: 2 } }),
        },
        $transaction: async (operation: (client: unknown) => Promise<void>) => {
          transactions.push(operation);
          return operation({
            providerAccount: {
              count: async () => 0,
              updateMany: async (input: Record<string, unknown>) => {
                updates.push(input);
                return { count: 1 };
              },
            },
          });
        },
      },
    } as never;
    const service = new BillingService(database);

    await service.setProviderAccountsEnabled("workspace-a", "connection-a", [
      "account-a",
      "account-a",
    ]);

    expect(transactions).toHaveLength(1);
    expect(updates).toEqual([
      {
        where: { workspaceId: "workspace-a", connectionId: "connection-a" },
        data: { enabled: false },
      },
      {
        where: {
          workspaceId: "workspace-a",
          connectionId: "connection-a",
          id: { in: ["account-a"] },
        },
        data: { enabled: true },
      },
    ]);
  });
});
