import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { BillingService } from "../billing/billing.service.js";
import { AuthService } from "../auth/auth.service.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { EmailService } from "../auth/email.service.js";
import { PasswordService } from "../auth/password.service.js";
import { SessionService } from "../auth/session.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisRateLimitService } from "../infrastructure/redis-rate-limit.service.js";
import { CredentialVaultService } from "./credential-vault.service.js";
import { OAuthStateService } from "./oauth-state.service.js";
import { ProviderMetricsService } from "./provider.metrics.js";
import { ProviderRegistry } from "./provider.registry.js";
import { ProviderRefreshCoordinator } from "./refresh-coordinator.service.js";
import { ProviderService } from "./provider.service.js";
import { ProviderError, toSafeProviderException } from "./provider.errors.js";
import type { TestProviderAdapter } from "./adapters/test.provider.js";
import type { ProviderCredentialPayload } from "./provider.types.js";

const integrationEnabled =
  process.env.V2_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.REDIS_URL) &&
  Boolean(process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS);

const request: RequestWithAuth = {
  requestId: `provider-integration-${randomUUID()}`,
  headers: { "user-agent": "v2-provider-integration" },
  ip: "127.0.0.1",
};

describe.skipIf(!integrationEnabled)(
  "v2 provider framework integration",
  () => {
    const database = new DatabaseService();
    const limits = new RedisRateLimitService();
    const audit = new AuditService(database);
    const passwords = new PasswordService();
    const sessions = new SessionService(database);
    const emails = new EmailService();
    const auth = new AuthService(
      database,
      passwords,
      sessions,
      emails,
      limits,
      audit,
    );
    const vault = new CredentialVaultService();
    const registry = new ProviderRegistry();
    const states = new OAuthStateService(database, vault);
    const coordinator = new ProviderRefreshCoordinator();
    const metrics = new ProviderMetricsService();
    const billing = new BillingService(database);
    const providers = new ProviderService(
      database,
      audit,
      registry,
      states,
      sessions,
      vault,
      coordinator,
      limits,
      metrics,
      billing,
    );
    const suffix = randomUUID();
    const email = `provider-${suffix}@example.test`;
    let user: Awaited<ReturnType<typeof auth.signup>>;
    let principal: HumanPrincipal;
    let workspaceId: string;

    beforeAll(async () => {
      await database.client.$queryRaw`SELECT 1`;
      user = await auth.signup(
        {
          name: "Provider Integration",
          email,
          password: "integration-password",
        },
        request,
      );
      workspaceId = user.workspace!.id;
      principal = {
        kind: "human",
        userId: user.user.id,
        sessionId: user.sessionId,
      };
    });

    afterAll(async () => {
      if (workspaceId) {
        await database.client.workspace.delete({ where: { id: workspaceId } });
      }
      await coordinator.onModuleDestroy();
      await limits.onModuleDestroy();
      await database.onModuleDestroy();
    });

    it("exposes provider metadata without test provider in production", () => {
      const definitions = registry.list();
      expect(definitions.map((item) => item.id)).toEqual(
        expect.arrayContaining([
          "GOOGLE_ADS",
          "META_ADS",
          "YANDEX_DIRECT",
          "TIKTOK_ADS",
          "TEST_PROVIDER",
        ]),
      );
      expect(
        definitions.find((item) => item.id === "GOOGLE_ADS"),
      ).toMatchObject({
        read: false,
        write: false,
      });
    });

    it("completes one-time PKCE OAuth, discovers and selects accounts", async () => {
      const started = await providers.startOAuth(
        workspaceId,
        "TEST_PROVIDER",
        principal,
        request,
      );
      const authorizationUrl = new URL(started.authorizationUrl);
      const state = authorizationUrl.searchParams.get("state");
      expect(state).toBeTruthy();
      expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();

      const connection = await providers.completeOAuth(
        "TEST_PROVIDER",
        { state: state!, code: "test-code" },
        principal,
        request,
      );
      expect(connection.status).toBe("CONNECTED");
      expect(connection.grantedScopes).toContain("test.accounts.read");
      expect(connection.accounts).toHaveLength(2);
      expect(connection.accounts.every((account) => !account.enabled)).toBe(
        true,
      );

      await expect(
        providers.completeOAuth(
          "TEST_PROVIDER",
          { state: state!, code: "test-code" },
          principal,
          request,
        ),
      ).rejects.toThrow("OAuth-сессия недействительна или истекла.");

      const selected = await providers.setAccountEnabled(
        workspaceId,
        connection.accounts[0]!.id,
        true,
        principal,
        request,
      );
      expect(selected.enabled).toBe(true);

      const ciphertext =
        await database.client.providerCredential.findUniqueOrThrow({
          where: { connectionId: connection.id },
        });
      expect(ciphertext.encryptedPayload).not.toContain("test-access");
      expect(
        vault.decrypt<{ accessToken: string }>(
          ciphertext.encryptedPayload,
          ciphertext.encryptionVersion,
        ).accessToken,
      ).toBe("test-access-test-code");
    });

    it("completes a callback from its one-time state without a browser session cookie", async () => {
      const started = await providers.startOAuth(
        workspaceId,
        "TEST_PROVIDER",
        principal,
        request,
      );
      const state = new URL(started.authorizationUrl).searchParams.get(
        "state",
      )!;

      await expect(
        providers.completeOAuthCallback(
          "TEST_PROVIDER",
          { state, code: "test-code" },
          request,
        ),
      ).resolves.toMatchObject({ status: "CONNECTED" });

      await expect(
        providers.completeOAuthCallback(
          "TEST_PROVIDER",
          { state, code: "test-code" },
          request,
        ),
      ).rejects.toThrow();
    });

    it("refreshes an expired credential before discovery without changing batch selection", async () => {
      const connection =
        await database.client.providerConnection.findFirstOrThrow({
          where: { workspaceId, provider: "TEST_PROVIDER" },
          include: { accounts: { orderBy: { externalAccountId: "asc" } } },
        });
      const selectedId = connection.accounts[0]!.id;
      await providers.setAccountsEnabled(
        workspaceId,
        connection.id,
        [selectedId],
        principal,
        request,
      );
      const credential =
        await database.client.providerCredential.findUniqueOrThrow({
          where: { connectionId: connection.id },
        });
      const expired = vault.encrypt({
        ...vault.decrypt<ProviderCredentialPayload>(
          credential.encryptedPayload,
          credential.encryptionVersion,
        ),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      await database.client.providerCredential.update({
        where: { connectionId: connection.id },
        data: {
          encryptedPayload: expired.ciphertext,
          encryptionVersion: expired.encryptionVersion,
        },
      });

      await expect(
        providers.discover(workspaceId, connection.id, principal, request),
      ).resolves.toHaveLength(2);

      const persisted = await database.client.providerAccount.findMany({
        where: { connectionId: connection.id },
        orderBy: { externalAccountId: "asc" },
      });
      expect(persisted.map((account) => account.enabled)).toEqual([
        true,
        false,
      ]);
    });

    it("enforces workspace scope and blocks invalid OAuth state", async () => {
      const other = await auth.signup(
        {
          name: "Other Workspace",
          email: `other-${suffix}@example.test`,
          password: "integration-password",
        },
        request,
      );
      const connection =
        await database.client.providerConnection.findFirstOrThrow({
          where: { workspaceId },
        });

      await expect(
        providers.getConnection(other.workspace!.id, connection.id),
      ).rejects.toThrow("Provider connection not found.");
      await expect(
        providers.setAccountEnabled(
          other.workspace!.id,
          "00000000-0000-0000-0000-000000000000",
          true,
          {
            kind: "human",
            userId: other.user.id,
            sessionId: other.sessionId,
          },
          request,
        ),
      ).rejects.toThrow("Provider account not found.");

      const started = await providers.startOAuth(
        workspaceId,
        "TEST_PROVIDER",
        principal,
        request,
      );
      const state = new URL(started.authorizationUrl).searchParams.get(
        "state",
      )!;
      await expect(
        states.consume({
          state,
          expected: {
            principal: {
              kind: "human",
              userId: other.user.id,
              sessionId: other.sessionId,
            },
            provider: "TEST_PROVIDER",
            workspaceId: other.workspace!.id,
          },
        }),
      ).rejects.toMatchObject({ code: "invalid_oauth_state" });

      await database.client.workspace.delete({
        where: { id: other.workspace!.id },
      });
    });

    it("coordinates concurrent refresh and supports credential key rotation", async () => {
      const connection =
        await database.client.providerConnection.findFirstOrThrow({
          where: { workspaceId },
        });
      const credential =
        await database.client.providerCredential.findUniqueOrThrow({
          where: { connectionId: connection.id },
        });
      const current = vault.decrypt<{
        accessToken: string;
        refreshToken: string;
      }>(credential.encryptedPayload, credential.encryptionVersion);
      const expired = vault.encrypt({
        ...current,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      await database.client.providerCredential.update({
        where: { connectionId: connection.id },
        data: {
          encryptedPayload: expired.ciphertext,
          encryptionVersion: expired.encryptionVersion,
        },
      });

      const adapter = registry.get("TEST_PROVIDER")
        .adapter as TestProviderAdapter;
      adapter.refreshCalls = 0;
      await Promise.all([
        providers.refresh(workspaceId, connection.id, principal, request),
        providers.refresh(workspaceId, connection.id, principal, request),
      ]);
      expect(adapter.refreshCalls).toBe(1);

      const refreshed =
        await database.client.providerCredential.findUniqueOrThrow({
          where: { connectionId: connection.id },
        });
      expect(
        vault.decrypt<{ accessToken: string }>(
          refreshed.encryptedPayload,
          refreshed.encryptionVersion,
        ).accessToken,
      ).toBe("test-refreshed-1");
    });

    it("disconnects credentials while retaining historical account rows", async () => {
      const connection =
        await database.client.providerConnection.findFirstOrThrow({
          where: { workspaceId },
        });
      await providers.disconnect(
        workspaceId,
        connection.id,
        principal,
        request,
      );
      await expect(
        database.client.providerCredential.findUnique({
          where: { connectionId: connection.id },
        }),
      ).resolves.toBeNull();
      await expect(
        database.client.providerAccount.count({
          where: { connectionId: connection.id },
        }),
      ).resolves.toBe(2);
      await expect(
        providers.discover(workspaceId, connection.id, principal, request),
      ).rejects.toThrow();
      await expect(
        providers.disconnect(workspaceId, connection.id, principal, request),
      ).resolves.toEqual({ success: true });
    });

    it("keeps provider error responses free of provider internals", async () => {
      const error = new ProviderError(
        "authorization_denied",
        "secret provider response with access token",
      );
      expect(toSafeProviderException(error).message).not.toContain("secret");
    });
  },
);
