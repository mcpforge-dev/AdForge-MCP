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
    };
    const database = {
      client: {
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
    const service = new McpPreviewService(database, audit);
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
});
