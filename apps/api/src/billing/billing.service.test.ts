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
});
