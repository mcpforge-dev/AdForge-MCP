import { describe, expect, it } from "vitest";
import { McpService } from "./mcp.service.js";

function serviceWithAccounts(accounts: Array<Record<string, unknown>>) {
  const database = {
    client: {
      providerAccount: {
        findMany: async () => accounts,
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const or = where.OR as Array<Record<string, string>>;
          return accounts.find(
            (account) =>
              account.workspaceId === where.workspaceId &&
              account.provider === where.provider &&
              account.enabled === true &&
              or.some(
                (condition) =>
                  account.id === condition.id ||
                  account.externalAccountId === condition.externalAccountId,
              ),
          );
        },
      },
    },
  } as never;
  const providers = {
    listProviders: () => [{ id: "GOOGLE_ADS", displayName: "Google Ads" }],
    readMetrics: async (
      _workspaceId: string,
      _connectionId: string,
      _accountId: string,
      dates: { startDate: string; endDate: string },
    ) =>
      dates.startDate === "2026-01-08"
        ? {
            spend: { amount: "150", currency: "USD" },
            impressions: 1500,
            clicks: 120,
            ctr: 0.08,
            cpc: { amount: "1.25", currency: "USD" },
            cpm: { amount: "100", currency: "USD" },
            conversions: 12,
            conversionValue: null,
            costPerConversion: { amount: "12.5", currency: "USD" },
          }
        : {
            spend: { amount: "100", currency: "USD" },
            impressions: 1000,
            clicks: 100,
            ctr: 0.1,
            cpc: { amount: "1", currency: "USD" },
            cpm: { amount: "100", currency: "USD" },
            conversions: 10,
            conversionValue: null,
            costPerConversion: { amount: "10", currency: "USD" },
          },
  } as never;
  const reports = {
    performance: async () => ({ reportType: "performance" }),
  } as never;
  const previews = {
    create: async () => ({ status: "preview" }),
    confirm: async () => ({ status: "confirmed" }),
    commit: async () => ({ status: "blocked" }),
  } as never;
  const siteAnalysis = { analyze: async () => ({ status: 200 }) } as never;
  return new McpService(database, providers, reports, previews, siteAnalysis);
}

describe("MCP V1-compatible policy", () => {
  const account = {
    id: "internal-account-a",
    workspaceId: "workspace-a",
    provider: "GOOGLE_ADS",
    externalAccountId: "1234567890",
    displayName: "Allowed account",
    currency: "USD",
    timezone: "UTC",
    status: "ACTIVE",
    enabled: true,
    connectionId: "connection-a",
  };

  it("exposes a stable read tool surface", () => {
    const service = serviceWithAccounts([account]);
    expect(service.tools().map((tool) => tool.name)).toContain(
      "get_basic_metrics",
    );
    expect(service.tools().map((tool) => tool.name)).not.toContain(
      "commit_change",
    );
  });

  it("does not allow an account outside a service-token restriction", async () => {
    const service = serviceWithAccounts([account]);
    await expect(
      service.call(
        {
          kind: "service",
          tokenId: "token",
          serviceIdentityId: "identity",
          workspaceId: "workspace-a",
          scopes: ["adforge:mcp:read"],
          accountIds: ["different-account"],
        },
        "get_account_summary",
        { provider: "google_ads", account_id: "1234567890" },
      ),
    ).rejects.toThrow("Account is not available to this service token.");
  });

  it("compares two periods using the provider read adapter", async () => {
    const service = serviceWithAccounts([account]);
    const result = (await service.call(
      {
        kind: "service",
        tokenId: "token",
        serviceIdentityId: "identity",
        workspaceId: "workspace-a",
        scopes: ["adforge:mcp:read"],
        accountIds: [],
      },
      "compare_periods",
      {
        provider: "google_ads",
        account_id: "1234567890",
        current_start_date: "2026-01-08",
        current_end_date: "2026-01-14",
        previous_start_date: "2026-01-01",
        previous_end_date: "2026-01-07",
      },
    )) as { changes: { spend: { absolute: number; percent: number } } };
    expect(result.changes.spend.absolute).toBe(50);
    expect(result.changes.spend.percent).toBe(50);
  });
});
