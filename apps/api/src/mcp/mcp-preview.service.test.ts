import { describe, expect, it } from "vitest";
import { McpPreviewService } from "./mcp-preview.service.js";

describe("MCP preview lifecycle", () => {
  it("consumes a confirmed preview on commit and blocks replay", async () => {
    const preview = {
      id: "preview-a",
      consumedAt: null as Date | null,
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      operation: "change_name",
      provider: "META_ADS",
      accountId: "account-a",
      externalObjectId: "campaign-a",
      payload: { new_name: "Review test" },
    };
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-a",
            externalAccountId: "act_1",
            provider: "META_ADS",
            connectionId: "connection-a",
          }),
        },
        mcpPreview: {
          findFirst: async () => preview,
          updateMany: async () => {
            if (preview.consumedAt) return { count: 0 };
            preview.consumedAt = new Date();
            return { count: 1 };
          },
        },
      },
    } as never;
    const audit = { record: async () => undefined } as never;
    const providers = { mutateCampaign: async () => ({ reread: null }) } as never;
    const service = new McpPreviewService(database, audit, providers);
    const principal = {
      kind: "service" as const,
      tokenId: "token-a",
      serviceIdentityId: "identity-a",
      workspaceId: "workspace-a",
      scopes: ["adforge:mcp:read", "adforge:mcp:write"],
      accountIds: [],
    };
    const result = await service.commit(
      principal,
      "hmpp_123456789012345678901234567890",
    );
    expect(result).toMatchObject({
      status: "blocked",
      execution_mode: "simulated_no_write",
    });
    await expect(
      service.commit(principal, "hmpp_123456789012345678901234567890"),
    ).rejects.toThrow("Preview has already been consumed.");
  });

  it("commits a confirmed allowlisted Meta mutation and returns reread", async () => {
    const previous = {
      preview: process.env.V2_PREVIEW_ONLY,
      enabled: process.env.V2_CONFIRMED_WRITE_ENABLED,
      accounts: process.env.V2_WRITE_ACCOUNT_ALLOWLIST,
      objects: process.env.V2_WRITE_OBJECT_ALLOWLIST,
      operations: process.env.V2_WRITE_OPERATION_ALLOWLIST,
    };
    Object.assign(process.env, {
      V2_PREVIEW_ONLY: "false",
      V2_CONFIRMED_WRITE_ENABLED: "true",
      V2_WRITE_ACCOUNT_ALLOWLIST: "act_1",
      V2_WRITE_OBJECT_ALLOWLIST: "campaign-a",
      V2_WRITE_OPERATION_ALLOWLIST: "change_name",
    });
    const preview = {
      id: "preview-b",
      consumedAt: null as Date | null,
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      operation: "change_name",
      provider: "META_ADS",
      accountId: "account-a",
      externalObjectId: "campaign-a",
      payload: { new_name: "Review test" },
    };
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-a",
            externalAccountId: "act_1",
            provider: "META_ADS",
            connectionId: "connection-a",
          }),
        },
        mcpPreview: {
          findFirst: async () => preview,
          updateMany: async () => {
            if (preview.consumedAt) return { count: 0 };
            preview.consumedAt = new Date();
            return { count: 1 };
          },
        },
      },
    } as never;
    const audit = { record: async () => undefined } as never;
    const providers = {
      mutateCampaign: async () => ({ reread: { id: "campaign-a", name: "Review test" } }),
    } as never;
    try {
      const service = new McpPreviewService(database, audit, providers);
      await expect(
        service.commit(
          {
            kind: "service",
            tokenId: "token-a",
            serviceIdentityId: "identity-a",
            workspaceId: "workspace-a",
            scopes: ["adforge:mcp:read", "adforge:mcp:write"],
            accountIds: ["account-a"],
          },
          "hmpp_123456789012345678901234567891",
        ),
      ).resolves.toMatchObject({
        status: "committed",
        reread: { id: "campaign-a", name: "Review test" },
      });
    } finally {
      setOptionalEnv("V2_PREVIEW_ONLY", previous.preview);
      setOptionalEnv("V2_CONFIRMED_WRITE_ENABLED", previous.enabled);
      setOptionalEnv("V2_WRITE_ACCOUNT_ALLOWLIST", previous.accounts);
      setOptionalEnv("V2_WRITE_OBJECT_ALLOWLIST", previous.objects);
      setOptionalEnv("V2_WRITE_OPERATION_ALLOWLIST", previous.operations);
    }
  });
});

function setOptionalEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
