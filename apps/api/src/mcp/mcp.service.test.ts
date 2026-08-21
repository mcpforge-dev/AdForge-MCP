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
  } as never;
  const reports = {
    performance: async () => ({ reportType: "performance" }),
  } as never;
  return new McpService(database, providers, reports);
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
});
