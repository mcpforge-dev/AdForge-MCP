import { describe, expect, it } from "vitest";
import { McpPreviewService } from "./mcp-preview.service.js";

describe("MCP preview lifecycle", () => {
  it("uses an external provider account identifier without querying the UUID column", async () => {
    let where: unknown;
    const database = {
      client: {
        providerAccount: {
          findFirst: async (input: { where: unknown }) => {
            where = input.where;
            return {
              id: "account-a",
              connectionId: "connection-a",
              externalAccountId: "act_1423247033195473",
              provider: "META_ADS",
            };
          },
        },
        mcpPreview: {
          create: async () => ({ id: "preview-a" }),
        },
      },
    } as never;
    const service = new McpPreviewService(
      database,
      { record: async () => undefined } as never,
      {} as never,
    );

    await service.create(
      {
        kind: "service",
        tokenId: "token-a",
        serviceIdentityId: "identity-a",
        workspaceId: "workspace-a",
        scopes: ["adforge:mcp:read"],
        accountIds: ["account-a"],
      },
      {
        provider: "META_ADS",
        accountId: "act_1423247033195473",
        objectId: "campaign-a",
        operation: "change_name",
        payload: { new_name: "Renamed campaign" },
      },
    );

    expect(where).toMatchObject({
      OR: [{ externalAccountId: "act_1423247033195473" }],
    });
  });

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
    const providers = {
      mutateCampaign: async () => ({ reread: null }),
    } as never;
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
      mutateCampaign: async () => ({
        reread: { id: "campaign-a", name: "Review test" },
      }),
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

  it("performs only the controlled Meta App Review rename after a PAUSED pre-read", async () => {
    const names = [
      "V2_META_APP_REVIEW_RENAME_ENABLED",
      "V2_META_APP_REVIEW_RENAME_ACCOUNT_ID",
      "V2_META_APP_REVIEW_RENAME_CAMPAIGN_ID",
      "V2_META_APP_REVIEW_RENAME_EXPECTED_NAME",
      "V2_META_APP_REVIEW_RENAME_TARGET_NAME",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, {
      V2_META_APP_REVIEW_RENAME_ENABLED: "true",
      V2_META_APP_REVIEW_RENAME_ACCOUNT_ID: "act_1423247033195473",
      V2_META_APP_REVIEW_RENAME_CAMPAIGN_ID: "120251139085310324",
      V2_META_APP_REVIEW_RENAME_EXPECTED_NAME: "hm_saqta_traffic_inst",
      V2_META_APP_REVIEW_RENAME_TARGET_NAME: "hm_saqta_traffic_inst_rename",
    });
    const preview = {
      id: "preview-review",
      consumedAt: null as Date | null,
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      operation: "change_name",
      provider: "META_ADS",
      accountId: "account-a",
      externalObjectId: "120251139085310324",
      payload: { new_name: "hm_saqta_traffic_inst_rename" },
    };
    const records: Array<Record<string, unknown>> = [];
    const before = {
      id: preview.externalObjectId,
      accountId: "act_1423247033195473",
      name: "hm_saqta_traffic_inst",
      status: "PAUSED",
      effectiveStatus: "PAUSED",
      objective: "OUTCOME_TRAFFIC",
      dailyBudget: null,
      lifetimeBudget: null,
      buyingType: "AUCTION",
      startTime: null,
      stopTime: null,
    };
    const mutateCampaign = async (...args: unknown[]) => {
      expect(args.slice(3)).toEqual([
        preview.externalObjectId,
        "change_name",
        { new_name: "hm_saqta_traffic_inst_rename" },
      ]);
      return { result: { providerAccepted: true }, reread: null };
    };
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-a",
            externalAccountId: "act_1423247033195473",
            provider: "META_ADS",
            connectionId: "connection-a",
          }),
        },
        mcpPreview: {
          findFirst: async () => preview,
          updateMany: async () => ({ count: 1 }),
        },
      },
    } as never;
    const providers = {
      mutateCampaign,
      readMetaControlledCampaign: async () =>
        records.some(
          (record) => record.eventType === "meta_app_review_rename_prechecked",
        )
          ? { ...before, name: "hm_saqta_traffic_inst_rename" }
          : before,
    } as never;
    const audit = {
      record: async (record: Record<string, unknown>) => records.push(record),
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
          "hmpp_123456789012345678901234567892",
        ),
      ).resolves.toMatchObject({
        status: "committed",
        reread: { name: "hm_saqta_traffic_inst_rename", status: "PAUSED" },
      });
      expect(records.map((record) => record.eventType)).toEqual([
        "meta_app_review_rename_prechecked",
        "meta_app_review_rename_completed",
      ]);
    } finally {
      for (const name of names) setOptionalEnv(name, previous[name]);
    }
  });
});

function setOptionalEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
