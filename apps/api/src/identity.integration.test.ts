import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { AuditService } from "./audit/audit.service.js";
import { AuthService } from "./auth/auth.service.js";
import type { RequestWithAuth } from "./auth/auth.types.js";
import { EmailService } from "./auth/email.service.js";
import { PasswordService } from "./auth/password.service.js";
import { SessionService } from "./auth/session.service.js";
import { DatabaseService } from "./infrastructure/database.service.js";
import { RedisRateLimitService } from "./infrastructure/redis-rate-limit.service.js";
import { WorkspaceService } from "./workspaces/workspace.service.js";

const integrationEnabled =
  process.env.V2_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.REDIS_URL);

const request: RequestWithAuth = {
  requestId: `integration-${randomUUID()}`,
  headers: { "user-agent": "v2-integration" },
  ip: "127.0.0.1",
};

describe.skipIf(!integrationEnabled)("v2 identity integration", () => {
  const database = new DatabaseService();
  const passwords = new PasswordService();
  const sessions = new SessionService(database);
  const emails = new EmailService();
  const limits = new RedisRateLimitService();
  const audit = new AuditService(database);
  const auth = new AuthService(
    database,
    passwords,
    sessions,
    emails,
    limits,
    audit,
  );
  const workspaces = new WorkspaceService(database, audit, emails, limits);
  const suffix = randomUUID();
  const emailA = `phase2-a-${suffix}@example.test`;
  const emailB = `phase2-b-${suffix}@example.test`;
  let userA: Awaited<ReturnType<typeof auth.signup>>;
  let userB: Awaited<ReturnType<typeof auth.signup>>;

  beforeAll(async () => {
    await database.client.$queryRaw`SELECT 1`;
    userA = await auth.signup(
      { name: "Phase 2 A", email: emailA, password: "integration-password-a" },
      request,
    );
    userB = await auth.signup(
      { name: "Phase 2 B", email: emailB, password: "integration-password-b" },
      request,
    );
  });

  afterAll(async () => {
    await database.client.user.deleteMany({
      where: { email: { in: [emailA, emailB] } },
    });
    await limits.onModuleDestroy();
    await database.onModuleDestroy();
  });

  it("creates isolated workspaces and server-side sessions", async () => {
    expect(userA.workspace?.id).toBeTruthy();
    expect(userB.workspace?.id).toBeTruthy();
    expect(userA.workspace?.id).not.toBe(userB.workspace?.id);
    expect(
      await workspaces.listForUser({
        kind: "human",
        userId: userA.user.id,
        sessionId: userA.sessionId,
      }),
    ).toHaveLength(1);

    const session = await sessions.validate(userA.sessionToken);
    expect(session?.userId).toBe(userA.user.id);
    await sessions.revoke(session!.id);
    await expect(sessions.validate(userA.sessionToken)).resolves.toBeNull();
  });

  it("rejects an invalid password without revealing account details", async () => {
    await expect(
      auth.login({ email: emailA, password: "wrong-password" }, request),
    ).rejects.toThrow("Invalid email or password.");
    await expect(
      auth.forgotPassword({ email: `missing-${suffix}@example.test` }, request),
    ).resolves.toEqual({
      message: expect.any(String),
    });
  });
});
