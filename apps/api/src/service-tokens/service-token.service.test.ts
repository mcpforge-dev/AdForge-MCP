import { describe, expect, it } from "vitest";
import {
  ServiceTokenService,
  hashServiceToken,
} from "./service-token.service.js";

describe("service token security primitives", () => {
  it("stores only a digest and never exposes the raw token", () => {
    const raw = "hmst_example-secret-value";
    const digest = hashServiceToken(raw);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(raw);
    expect(hashServiceToken(raw)).toBe(digest);
    expect(hashServiceToken(`${raw}-changed`)).not.toBe(digest);
  });

  it("allows write scope only for a token restricted to one account", async () => {
    let updateInput: Record<string, unknown> | undefined;
    const database = {
      client: {
        serviceToken: {
          findFirst: async () => ({
            id: "token-a",
            accountIds: ["account-a"],
            serviceIdentity: { id: "identity-a" },
          }),
          update: async (input: Record<string, unknown>) => {
            updateInput = input;
            return {
              id: "token-a",
              tokenPrefix: "hmst_example",
              name: "Review client",
              scopes: ["adforge:mcp:read", "adforge:mcp:write"],
              accountIds: ["account-a"],
              createdAt: new Date(),
              expiresAt: null,
              revokedAt: null,
              lastUsedAt: null,
            };
          },
        },
      },
    } as never;
    const audit = { record: async () => undefined } as never;
    const service = new ServiceTokenService(database, audit);

    await service.updateScopes(
      "workspace-a",
      "token-a",
      { scopes: ["adforge:mcp:read", "adforge:mcp:write"] },
      { kind: "human", userId: "user-a", sessionId: "session-a" },
      {} as never,
    );

    expect(updateInput).toEqual({
      where: { id: "token-a" },
      data: { scopes: ["adforge:mcp:read", "adforge:mcp:write"] },
    });
  });

  it("rejects write scope for a token that covers multiple accounts", async () => {
    const database = {
      client: {
        serviceToken: {
          findFirst: async () => ({
            id: "token-a",
            accountIds: ["account-a", "account-b"],
            serviceIdentity: { id: "identity-a" },
          }),
        },
      },
    } as never;
    const service = new ServiceTokenService(database, {
      record: async () => undefined,
    } as never);

    await expect(
      service.updateScopes(
        "workspace-a",
        "token-a",
        { scopes: ["adforge:mcp:read", "adforge:mcp:write"] },
        { kind: "human", userId: "user-a", sessionId: "session-a" },
        {} as never,
      ),
    ).rejects.toThrow(
      "Write scope requires a service token restricted to exactly one account.",
    );
  });
});
