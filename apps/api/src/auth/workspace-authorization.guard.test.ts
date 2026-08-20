import { describe, expect, it } from "vitest";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => "handler",
    getClass: () => "class",
  } as never;
}

function guardFor(role: string, permissions: string[]) {
  const reflector = {
    getAllAndOverride: () => permissions,
  };
  const database = {
    client: {
      workspaceMembership: {
        findUnique: async () => ({
          role,
          workspace: { id: "workspace-a", name: "A", slug: "a" },
        }),
      },
      rolePermission: {
        findMany: async () =>
          permissions.map((key) => ({ permission: { key } })),
      },
    },
  };
  return new WorkspaceAuthorizationGuard(reflector as never, database as never);
}

describe("WorkspaceAuthorizationGuard", () => {
  it("allows a member to read but not manage members", async () => {
    const readGuard = guardFor("MEMBER", ["workspace.read"]);
    await expect(
      readGuard.canActivate(
        context({
          params: { id: "workspace-a" },
          user: { kind: "human", userId: "user-a", sessionId: "session-a" },
        }),
      ),
    ).resolves.toBe(true);

    const request = context({
      params: { id: "workspace-a" },
      user: { kind: "human", userId: "user-a", sessionId: "session-a" },
    });
    const manageReflector = {
      getAllAndOverride: () => ["members.manage"],
    };
    const manage = new WorkspaceAuthorizationGuard(
      manageReflector as never,
      {
        client: {
          workspaceMembership: {
            findUnique: async () => ({
              role: "MEMBER",
              workspace: { id: "workspace-a", name: "A", slug: "a" },
            }),
          },
          rolePermission: {
            findMany: async () => [{ permission: { key: "workspace.read" } }],
          },
        },
      } as never,
    );
    await expect(manage.canActivate(request)).rejects.toThrow(
      "Permission denied.",
    );
  });

  it("denies a user with no membership", async () => {
    const database = {
      client: {
        workspaceMembership: { findUnique: async () => null },
        rolePermission: { findMany: async () => [] },
      },
    };
    const guard = new WorkspaceAuthorizationGuard(
      { getAllAndOverride: () => ["workspace.read"] } as never,
      database as never,
    );
    await expect(
      guard.canActivate(
        context({
          params: { id: "workspace-b" },
          user: { kind: "human", userId: "user-a", sessionId: "session-a" },
        }),
      ),
    ).rejects.toThrow("Workspace access denied.");
  });
});
