import { describe, expect, it, vi } from "vitest";
import { LegacyHostedController } from "./legacy-hosted.controller.js";
import { LegacyMcpTokenController } from "./legacy-mcp-token.controller.js";

const principal = {
  kind: "human" as const,
  userId: "user-member",
  sessionId: "session-member",
};

function workspaceService(
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
  accessStatus: "ACTIVE" | "PENDING" | "SUSPENDED" = "ACTIVE",
) {
  return {
    listForUser: vi.fn().mockResolvedValue([
      {
        id: "workspace-a",
        name: "Workspace A",
        slug: "workspace-a",
        role,
        accessStatus,
      },
    ]),
  };
}

describe("legacy compatibility RBAC", () => {
  it.each(["MEMBER", "VIEWER"] as const)(
    "blocks %s from starting provider OAuth through the legacy route",
    async (role) => {
      const providers = {
        startOAuth: vi.fn(),
        listConnections: vi.fn(),
        listProviders: vi.fn().mockReturnValue([]),
      };
      const controller = new LegacyHostedController(
        providers as never,
        workspaceService(role) as never,
      );

      await expect(
        controller.authorizeUrl("google", principal, {} as never),
      ).rejects.toThrow("Permission denied.");
      expect(providers.startOAuth).not.toHaveBeenCalled();
    },
  );

  it.each(["OWNER", "ADMIN"] as const)(
    "allows %s to start provider OAuth through the legacy route",
    async (role) => {
      const providers = {
        startOAuth: vi.fn().mockResolvedValue({
          authorizationUrl: "https://provider.example/oauth",
        }),
        listConnections: vi.fn(),
        listProviders: vi.fn().mockReturnValue([]),
      };
      const controller = new LegacyHostedController(
        providers as never,
        workspaceService(role) as never,
      );

      await expect(
        controller.authorizeUrl("google", principal, {} as never),
      ).resolves.toEqual({
        authorizationUrl: "https://provider.example/oauth",
      });
    },
  );

  it.each(["PENDING", "SUSPENDED"] as const)(
    "blocks OAuth and token management while the workspace is %s",
    async (accessStatus) => {
      const providers = {
        startOAuth: vi.fn(),
        listConnections: vi.fn(),
        listProviders: vi.fn().mockReturnValue([]),
      };
      const tokens = { list: vi.fn(), create: vi.fn(), revoke: vi.fn() };
      const workspaces = workspaceService("OWNER", accessStatus);
      const hosted = new LegacyHostedController(
        providers as never,
        workspaces as never,
      );
      const tokenController = new LegacyMcpTokenController(
        tokens as never,
        workspaces as never,
      );

      await expect(
        hosted.authorizeUrl("google", principal, {} as never),
      ).rejects.toThrow("Permission denied.");
      await expect(tokenController.summary(principal)).rejects.toThrow(
        "Permission denied.",
      );
    },
  );

  it.each(["MEMBER", "VIEWER"] as const)(
    "blocks %s from listing or creating service tokens through the legacy route",
    async (role) => {
      const tokens = { list: vi.fn(), create: vi.fn(), revoke: vi.fn() };
      const controller = new LegacyMcpTokenController(
        tokens as never,
        workspaceService(role) as never,
      );

      await expect(controller.summary(principal)).rejects.toThrow(
        "Permission denied.",
      );
      await expect(
        controller.create({}, principal, {} as never),
      ).rejects.toThrow("Permission denied.");
      expect(tokens.list).not.toHaveBeenCalled();
      expect(tokens.create).not.toHaveBeenCalled();
    },
  );
});
