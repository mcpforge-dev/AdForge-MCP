import { describe, expect, it, vi } from "vitest";
import {
  hashServiceToken,
  ServiceTokenService,
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

  it("lists only keys that have not been deleted", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ServiceTokenService(
      { client: { serviceToken: { findMany } } } as never,
      { record: vi.fn() } as never,
    );

    await service.list("workspace-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          revokedAt: null,
          serviceIdentity: { workspaceId: "workspace-1" },
        },
      }),
    );
  });

  it("does not delete a key that was already deleted", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ServiceTokenService(
      { client: { serviceToken: { findFirst } } } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.revoke(
        "workspace-1",
        "token-1",
        { userId: "user-1" } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "token-1",
        revokedAt: null,
        serviceIdentity: { workspaceId: "workspace-1" },
      },
    });
  });
});
