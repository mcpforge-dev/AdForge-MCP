import { describe, expect, it } from "vitest";
import { AdminAuthenticationGuard } from "./admin-authentication.guard.js";

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("AdminAuthenticationGuard", () => {
  it("does not treat a customer session or workspace role as system admin access", async () => {
    const service = {
      extractSessionToken: () => undefined,
      validateSession: async () => true,
    };
    const guard = new AdminAuthenticationGuard(service as never);

    await expect(
      guard.canActivate(
        context({
          user: { kind: "human", userId: "owner-user", sessionId: "session" },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns forbidden for a signed-in customer calling an admin endpoint directly", async () => {
    const service = {
      extractSessionToken: () => undefined,
      validateSession: async () => false,
    };
    const guard = new AdminAuthenticationGuard(service as never);

    await expect(
      guard.canActivate(
        context({
          user: { kind: "human", userId: "owner-user", sessionId: "session" },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("accepts only a validated independent admin session", async () => {
    const service = {
      extractSessionToken: () => "admin-session-token",
      validateSession: async (token: string) => token === "admin-session-token",
    };
    const guard = new AdminAuthenticationGuard(service as never);

    await expect(guard.canActivate(context({}))).resolves.toBe(true);
  });
});
