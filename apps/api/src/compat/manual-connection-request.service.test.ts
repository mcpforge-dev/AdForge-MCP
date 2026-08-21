import { describe, expect, it, vi } from "vitest";
import { ManualConnectionRequestService } from "./manual-connection-request.service.js";

const principal = {
  kind: "human" as const,
  userId: "specialist-a",
  sessionId: "session-a",
};

const request = { requestId: "request-a" } as never;

describe("manual Meta connection workflow", () => {
  it("rejects a request outside the specialist workspace", async () => {
    const database = {
      client: {
        manualConnectionRequest: {
          findUnique: vi.fn().mockResolvedValue({
            id: "request-a",
            workspaceId: "workspace-b",
          }),
        },
        workspaceMembership: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        userPermissionGrant: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    } as never;
    const service = new ManualConnectionRequestService(
      database,
      {} as never,
      {} as never,
    );

    await expect(service.pendingMeta(principal, "request-a")).rejects.toThrow(
      "Admin access required.",
    );
  });

  it("adds an account without disabling existing Meta accounts", async () => {
    const selected = {
      id: "provider-account-b",
      externalAccountId: "act_2",
      displayName: "Second account",
      enabled: true,
    };
    const update = vi.fn().mockResolvedValue(selected);
    const database = {
      client: {
        manualConnectionRequest: {
          findUnique: vi.fn().mockResolvedValue({
            id: "request-a",
            workspaceId: "workspace-a",
          }),
          update: vi.fn().mockResolvedValue(undefined),
        },
        workspaceMembership: {
          findUnique: vi.fn().mockResolvedValue({ role: "ADMIN" }),
        },
        userPermissionGrant: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        providerAccount: {
          findFirst: vi.fn().mockResolvedValue({
            id: selected.id,
            workspaceId: "workspace-a",
            provider: "META_ADS",
            externalAccountId: selected.externalAccountId,
          }),
          update,
        },
      },
    } as never;
    const audit = { record: vi.fn().mockResolvedValue(undefined) } as never;
    const service = new ManualConnectionRequestService(
      database,
      audit,
      {} as never,
    );

    const result = await service.selectMeta(
      principal,
      "request-a",
      selected.externalAccountId,
      request,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: selected.id },
      data: { enabled: true },
    });
    expect(result.account).toMatchObject({
      external_account_id: selected.externalAccountId,
      enabled: true,
    });
  });

  it("allows a support grant without workspace membership", async () => {
    const database = {
      client: {
        manualConnectionRequest: {
          findUnique: vi.fn().mockResolvedValue({
            id: "request-a",
            workspaceId: "workspace-client",
          }),
        },
        userPermissionGrant: {
          findFirst: vi.fn().mockResolvedValue({ id: "grant-a" }),
        },
        providerConnection: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    } as never;
    const service = new ManualConnectionRequestService(
      database,
      {} as never,
      {} as never,
    );

    await expect(
      service.pendingMeta(principal, "request-a"),
    ).resolves.toMatchObject({
      request_id: "request-a",
      pending: [],
      real_data: false,
    });
  });
});
