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

class CapturingEmailService extends EmailService {
  public readonly messages: Array<{
    kind: string;
    email: string;
    token: string;
  }> = [];

  public override async sendVerification(
    email: string,
    token: string,
  ): Promise<void> {
    this.messages.push({ kind: "verification", email, token });
  }

  public override async sendPasswordReset(
    email: string,
    token: string,
  ): Promise<void> {
    this.messages.push({ kind: "password_reset", email, token });
  }

  public override async sendInvitation(
    email: string,
    token: string,
  ): Promise<void> {
    this.messages.push({ kind: "invitation", email, token });
  }
}

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
  const emails = new CapturingEmailService();
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
  const emailC = `phase2-c-${suffix}@example.test`;
  let userA: Awaited<ReturnType<typeof auth.signup>>;
  let userB: Awaited<ReturnType<typeof auth.signup>>;
  let userC: Awaited<ReturnType<typeof auth.signup>>;

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
    userC = await auth.signup(
      { name: "Phase 2 C", email: emailC, password: "integration-password-c" },
      request,
    );
  });

  afterAll(async () => {
    const workspaceIds = [
      userA?.workspace?.id,
      userB?.workspace?.id,
      userC?.workspace?.id,
    ].filter((id): id is string => Boolean(id));
    await database.client.workspace.deleteMany({
      where: { id: { in: workspaceIds } },
    });
    await database.client.user.deleteMany({
      where: { email: { in: [emailA, emailB, emailC] } },
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

  it("supports logout, logout-all, expiration and one-time password reset", async () => {
    const logoutSession = await sessions.create(userA.user.id, request);
    await auth.logout(
      {
        kind: "human",
        userId: userA.user.id,
        sessionId: logoutSession.session.id,
      },
      request,
    );
    await expect(sessions.validate(logoutSession.token)).resolves.toBeNull();

    const allSessionA = await sessions.create(userA.user.id, request);
    const allSessionB = await sessions.create(userA.user.id, request);
    await auth.logoutAll(
      {
        kind: "human",
        userId: userA.user.id,
        sessionId: allSessionA.session.id,
      },
      request,
    );
    await expect(sessions.validate(allSessionA.token)).resolves.toBeNull();
    await expect(sessions.validate(allSessionB.token)).resolves.toBeNull();

    const expired = await sessions.create(userA.user.id, request);
    await database.client.session.update({
      where: { id: expired.session.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(sessions.validate(expired.token)).resolves.toBeNull();

    await auth.forgotPassword({ email: emailA }, request);
    const resetMessage = [...emails.messages]
      .reverse()
      .find((message) => message.kind === "password_reset");
    expect(resetMessage?.token).toBeTruthy();
    await auth.resetPassword(
      { token: resetMessage!.token, password: "integration-password-reset" },
      request,
    );
    await expect(
      auth.resetPassword(
        { token: resetMessage!.token, password: "integration-password-replay" },
        request,
      ),
    ).rejects.toThrow("Reset link is invalid or expired.");
    await expect(
      auth.login(
        { email: emailA, password: "integration-password-reset" },
        request,
      ),
    ).resolves.toMatchObject({ user: { email: emailA } });
  });

  it("supports invitation accept, replay, revoke and expiration", async () => {
    const workspaceId = userA.workspace!.id;
    const currentA = await auth.login(
      { email: emailA, password: "integration-password-reset" },
      request,
    );
    const principalA = {
      kind: "human" as const,
      userId: userA.user.id,
      sessionId: currentA.sessionId,
    };
    const accepted = await workspaces.createInvitation(
      workspaceId,
      { email: emailC, role: "MEMBER" },
      principalA,
      request,
    );
    const acceptedMessage = [...emails.messages]
      .reverse()
      .find(
        (message) => message.kind === "invitation" && message.email === emailC,
      );
    await expect(
      workspaces.acceptInvitation(
        { token: acceptedMessage!.token },
        { kind: "human", userId: userC.user.id, sessionId: userC.sessionId },
        request,
      ),
    ).resolves.toEqual({ success: true, workspaceId });
    await expect(
      workspaces.acceptInvitation(
        { token: acceptedMessage!.token },
        { kind: "human", userId: userC.user.id, sessionId: userC.sessionId },
        request,
      ),
    ).rejects.toThrow("Invitation is invalid or expired.");
    expect(accepted.email).toBe(emailC);

    const revoked = await workspaces.createInvitation(
      workspaceId,
      { email: emailB, role: "VIEWER" },
      principalA,
      request,
    );
    const revokedMessage = [...emails.messages]
      .reverse()
      .find(
        (message) => message.kind === "invitation" && message.email === emailB,
      );
    await workspaces.revokeInvitation(
      workspaceId,
      revoked.id,
      principalA,
      request,
    );
    await expect(
      workspaces.acceptInvitation(
        { token: revokedMessage!.token },
        { kind: "human", userId: userB.user.id, sessionId: userB.sessionId },
        request,
      ),
    ).rejects.toThrow("Invitation is invalid or expired.");

    const expired = await workspaces.createInvitation(
      workspaceId,
      { email: emailB, role: "VIEWER" },
      principalA,
      request,
    );
    const expiredMessage = [...emails.messages]
      .reverse()
      .find(
        (message) => message.kind === "invitation" && message.email === emailB,
      );
    await database.client.workspaceInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(
      workspaces.acceptInvitation(
        { token: expiredMessage!.token },
        { kind: "human", userId: userB.user.id, sessionId: userB.sessionId },
        request,
      ),
    ).rejects.toThrow("Invitation is invalid or expired.");
  });
});
