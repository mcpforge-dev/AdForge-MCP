import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ProviderAccountView,
  ProviderConnectionView,
  ProviderDefinition,
  ProviderId,
} from "@holymedia/contracts";
import type { Prisma } from "@holymedia/database";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { AuditService } from "../audit/audit.service.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisRateLimitService } from "../infrastructure/redis-rate-limit.service.js";
import { hashIp } from "../infrastructure/security.utils.js";
import { CredentialVaultService } from "./credential-vault.service.js";
import { OAuthStateService } from "./oauth-state.service.js";
import { ProviderError, toSafeProviderException } from "./provider.errors.js";
import { ProviderRefreshCoordinator } from "./refresh-coordinator.service.js";
import { ProviderRegistry } from "./provider.registry.js";
import { ProviderMetricsService } from "./provider.metrics.js";
import type {
  NormalizedProviderAccount,
  ProviderCredentialPayload,
  ProviderScopeMetadata,
} from "./provider.types.js";

@Injectable()
export class ProviderService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(OAuthStateService) private readonly states: OAuthStateService,
    @Inject(CredentialVaultService)
    private readonly vault: CredentialVaultService,
    @Inject(ProviderRefreshCoordinator)
    private readonly refreshCoordinator: ProviderRefreshCoordinator,
    @Inject(RedisRateLimitService)
    private readonly limits: RedisRateLimitService,
    @Inject(ProviderMetricsService)
    private readonly metrics: ProviderMetricsService,
  ) {}

  public listProviders(): ProviderDefinition[] {
    return this.registry.list();
  }

  public async listConnections(
    workspaceId: string,
  ): Promise<ProviderConnectionView[]> {
    const connections = await this.database.client.providerConnection.findMany({
      where: { workspaceId },
      include: { accounts: { orderBy: { displayName: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    return connections.map((connection) => this.toView(connection));
  }

  public async getConnection(
    workspaceId: string,
    connectionId: string,
  ): Promise<ProviderConnectionView> {
    const connection = await this.database.client.providerConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { accounts: { orderBy: { displayName: "asc" } } },
    });
    if (!connection)
      throw new NotFoundException("Provider connection not found.");
    return this.toView(connection);
  }

  public async startOAuth(
    workspaceId: string,
    provider: ProviderId,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<{ authorizationUrl: string; provider: ProviderId }> {
    const entry = this.registry.get(provider);
    if (!entry.adapter)
      throw toSafeProviderException(
        new ProviderError(
          "provider_not_configured",
          "Provider OAuth is not configured.",
        ),
      );
    await this.limits.consume(
      `v2:rl:oauth-start:ip:${hashIp(request.ip, this.config.sessionHashSecret) ?? "unknown"}`,
      10,
      900,
    );
    const pendingStates = await this.database.client.oAuthState.count({
      where: {
        userId: principal.userId,
        workspaceId,
        provider: provider as never,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pendingStates >= 10)
      throw toSafeProviderException(
        new ProviderError("rate_limited", "Too many pending OAuth attempts."),
      );
    const existing = await this.database.client.providerConnection.findUnique({
      where: {
        workspaceId_provider: { workspaceId, provider: provider as never },
      },
      select: { id: true },
    });
    const state = await this.states.create({
      principal,
      workspaceId,
      provider,
      sessionId: principal.sessionId,
      usePkce: entry.definition.pkce,
      ...(existing ? { connectionId: existing.id } : {}),
    });
    const authorizationUrl = entry.adapter.authorizationUrl({
      state: state.state,
      redirectUri: this.redirectUri(provider),
      ...(state.authorizationState.codeChallenge
        ? {
            codeChallenge: state.authorizationState.codeChallenge,
            codeChallengeMethod: "S256" as const,
          }
        : {}),
    });
    await this.record(
      "oauth_started",
      request,
      principal,
      workspaceId,
      provider,
    );
    return { authorizationUrl, provider };
  }

  public async completeOAuth(
    provider: ProviderId,
    input: { state: string; code: string },
    principal: HumanPrincipal,
    request: RequestWithAuth,
    workspaceId?: string,
  ): Promise<ProviderConnectionView> {
    const entry = this.registry.get(provider);
    if (!entry.adapter)
      throw toSafeProviderException(
        new ProviderError(
          "provider_not_configured",
          "Provider OAuth is not configured.",
        ),
      );
    await this.limits.consume(
      `v2:rl:oauth-callback:ip:${hashIp(request.ip, this.config.sessionHashSecret) ?? "unknown"}`,
      30,
      900,
    );
    try {
      const startedAt = Date.now();
      const state = await this.states.consume({
        state: input.state,
        expected: {
          principal,
          provider,
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
      const credentials = await entry.adapter.exchangeCode({
        code: input.code,
        redirectUri: this.redirectUri(provider),
        ...(state.codeVerifier ? { codeVerifier: state.codeVerifier } : {}),
      });
      const scopeMetadata = this.scopeMetadata(
        entry.definition.scopes,
        credentials.scopes,
      );
      const encrypted = this.vault.encrypt(credentials);
      let isReconnect = false;
      const connection = await this.database.client.$transaction(async (tx) => {
        const current = await tx.providerConnection.findUnique({
          where: {
            workspaceId_provider: {
              workspaceId: state.workspaceId,
              provider: provider as never,
            },
          },
          select: { id: true, credentialVersion: true },
        });
        isReconnect = Boolean(current);
        const saved = await tx.providerConnection.upsert({
          where: {
            workspaceId_provider: {
              workspaceId: state.workspaceId,
              provider: provider as never,
            },
          },
          create: {
            workspaceId: state.workspaceId,
            provider: provider as never,
            status: "CONNECTED",
            ...(credentials.externalSubjectId
              ? { externalSubjectId: credentials.externalSubjectId }
              : {}),
            ...(credentials.displayName
              ? { displayName: credentials.displayName }
              : {}),
            createdBy: state.userId,
            connectedAt: new Date(),
            lastSuccessAt: new Date(),
            credentialVersion: 1,
            metadata: scopeMetadata,
          },
          update: {
            status: "CONNECTED",
            ...(credentials.externalSubjectId
              ? { externalSubjectId: credentials.externalSubjectId }
              : { externalSubjectId: null }),
            ...(credentials.displayName
              ? { displayName: credentials.displayName }
              : { displayName: null }),
            disconnectedAt: null,
            lastErrorAt: null,
            lastErrorCode: null,
            connectedAt: new Date(),
            lastSuccessAt: new Date(),
            credentialVersion: (current?.credentialVersion ?? 0) + 1,
            metadata: scopeMetadata,
          },
        });
        await tx.providerCredential.upsert({
          where: { connectionId: saved.id },
          create: {
            connectionId: saved.id,
            encryptedPayload: encrypted.ciphertext,
            encryptionVersion: encrypted.encryptionVersion,
          },
          update: {
            encryptedPayload: encrypted.ciphertext,
            encryptionVersion: encrypted.encryptionVersion,
          },
        });
        return saved;
      });
      await this.persistAccounts(
        state.workspaceId,
        connection.id,
        provider,
        credentials,
        entry.adapter,
      );
      await this.record(
        "oauth_completed",
        request,
        principal,
        state.workspaceId,
        provider,
        connection.id,
      );
      if (isReconnect) {
        await this.record(
          "connection_reconnected",
          request,
          principal,
          state.workspaceId,
          provider,
          connection.id,
        );
      }
      this.metrics.record("oauth_success", provider, Date.now() - startedAt);
      return this.getConnection(state.workspaceId, connection.id);
    } catch (error) {
      this.metrics.record("oauth_failure", provider);
      await this.record(
        "oauth_failed",
        request,
        principal,
        workspaceId,
        provider,
        undefined,
        error,
      );
      throw toSafeProviderException(error);
    }
  }

  public async disconnect(
    workspaceId: string,
    connectionId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<{ success: true }> {
    const connection = await this.connectionWithCredential(
      workspaceId,
      connectionId,
    );
    if (connection.credential) {
      try {
        const credentials = this.vault.decrypt<ProviderCredentialPayload>(
          connection.credential.encryptedPayload,
          connection.credential.encryptionVersion,
        );
        const adapter = this.registry.get(
          connection.provider as ProviderId,
        ).adapter;
        if (adapter?.revokeCredentials)
          await adapter.revokeCredentials(credentials);
      } catch {
        // Local disconnect remains successful even if provider revocation is unavailable.
      }
    }
    await this.database.client.$transaction(async (tx) => {
      await tx.providerCredential.deleteMany({ where: { connectionId } });
      await tx.providerConnection.update({
        where: { id: connectionId },
        data: { status: "DISCONNECTED", disconnectedAt: new Date() },
      });
    });
    await this.record(
      "connection_disconnected",
      request,
      principal,
      workspaceId,
      connection.provider as ProviderId,
      connectionId,
    );
    return { success: true };
  }

  public async refresh(
    workspaceId: string,
    connectionId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<ProviderConnectionView> {
    return this.refreshCoordinator.withLock(connectionId, async () => {
      const connection = await this.connectionWithCredential(
        workspaceId,
        connectionId,
      );
      if (!connection.credential)
        throw new ProviderError(
          "token_expired",
          "Provider authorization is required.",
        );
      const current = this.vault.decrypt<ProviderCredentialPayload>(
        connection.credential.encryptedPayload,
        connection.credential.encryptionVersion,
      );
      if (
        current.expiresAt &&
        new Date(current.expiresAt).getTime() > Date.now() + 30_000
      ) {
        return this.toView(
          await this.connectionWithAccounts(workspaceId, connectionId),
        );
      }
      const adapter = this.registry.adapter(connection.provider as ProviderId);
      if (!adapter.refreshCredentials)
        throw new ProviderError(
          "refresh_failed",
          "Provider refresh is not supported.",
        );
      try {
        const startedAt = Date.now();
        const refreshed = await adapter.refreshCredentials(current);
        const encrypted = this.vault.encrypt(refreshed);
        await this.database.client.$transaction(async (tx) => {
          await tx.providerCredential.update({
            where: { connectionId },
            data: {
              encryptedPayload: encrypted.ciphertext,
              encryptionVersion: encrypted.encryptionVersion,
            },
          });
          await tx.providerConnection.update({
            where: { id: connectionId },
            data: {
              status: "CONNECTED",
              lastSuccessAt: new Date(),
              lastErrorAt: null,
              lastErrorCode: null,
            },
          });
        });
        await this.record(
          "credentials_refreshed",
          request,
          principal,
          workspaceId,
          connection.provider as ProviderId,
          connectionId,
        );
        this.metrics.record(
          "token_refresh_success",
          connection.provider as ProviderId,
          Date.now() - startedAt,
        );
        return this.toView(
          await this.connectionWithAccounts(workspaceId, connectionId),
        );
      } catch (error) {
        this.metrics.record(
          "token_refresh_failure",
          connection.provider as ProviderId,
        );
        await this.database.client.providerConnection.update({
          where: { id: connectionId },
          data: {
            status: "REAUTH_REQUIRED",
            lastErrorAt: new Date(),
            lastErrorCode:
              error instanceof ProviderError ? error.code : "refresh_failed",
          },
        });
        throw toSafeProviderException(error);
      }
    });
  }

  public async discover(
    workspaceId: string,
    connectionId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<ProviderAccountView[]> {
    await this.limits.consume(
      `v2:rl:account-discovery:workspace:${workspaceId}`,
      10,
      900,
    );
    const connection = await this.connectionWithCredential(
      workspaceId,
      connectionId,
    );
    if (!connection.credential)
      throw new ProviderError(
        "authentication_failed",
        "Provider authorization is required.",
      );
    const credentials = this.vault.decrypt<ProviderCredentialPayload>(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    const adapter = this.registry.adapter(connection.provider as ProviderId);
    try {
      const startedAt = Date.now();
      await this.persistAccounts(
        workspaceId,
        connectionId,
        connection.provider as ProviderId,
        credentials,
        adapter,
      );
      await this.record(
        "accounts_discovered",
        request,
        principal,
        workspaceId,
        connection.provider as ProviderId,
        connectionId,
      );
      this.metrics.record(
        "account_discovery_success",
        connection.provider as ProviderId,
        Date.now() - startedAt,
      );
      const current = await this.connectionWithAccounts(
        workspaceId,
        connectionId,
      );
      return current.accounts.map((account) => this.accountView(account));
    } catch (error) {
      this.metrics.record(
        "account_discovery_failure",
        connection.provider as ProviderId,
      );
      await this.database.client.providerConnection.update({
        where: { id: connectionId },
        data: {
          status: "DEGRADED",
          lastErrorAt: new Date(),
          lastErrorCode:
            error instanceof ProviderError
              ? error.code
              : "provider_response_invalid",
        },
      });
      throw toSafeProviderException(error);
    }
  }

  public async setAccountEnabled(
    workspaceId: string,
    accountId: string,
    enabled: boolean,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<ProviderAccountView> {
    const result = await this.database.client.providerAccount.updateMany({
      where: { id: accountId, workspaceId },
      data: { enabled },
    });
    if (result.count !== 1)
      throw new NotFoundException("Provider account not found.");
    const account =
      await this.database.client.providerAccount.findUniqueOrThrow({
        where: { id: accountId },
      });
    await this.record(
      enabled ? "provider_account_enabled" : "provider_account_disabled",
      request,
      principal,
      workspaceId,
      account.provider as ProviderId,
      accountId,
    );
    return this.accountView(account);
  }

  private async persistAccounts(
    workspaceId: string,
    connectionId: string,
    provider: ProviderId,
    credentials: ProviderCredentialPayload,
    adapter: {
      discoverAccounts: (
        credentials: ProviderCredentialPayload,
      ) => Promise<NormalizedProviderAccount[]>;
    },
  ) {
    const accounts = await adapter.discoverAccounts(credentials);
    await this.database.client.$transaction(async (tx) => {
      for (const account of accounts) {
        await tx.providerAccount.upsert({
          where: {
            workspaceId_provider_externalAccountId: {
              workspaceId,
              provider: provider as never,
              externalAccountId: account.externalAccountId,
            },
          },
          create: {
            connectionId,
            workspaceId,
            provider: provider as never,
            externalAccountId: account.externalAccountId,
            displayName: account.displayName,
            ...(account.currency ? { currency: account.currency } : {}),
            ...(account.timezone ? { timezone: account.timezone } : {}),
            ...(account.status ? { status: account.status } : {}),
            ...(account.metadata ? { metadata: account.metadata } : {}),
          },
          update: {
            connectionId,
            displayName: account.displayName,
            ...(account.currency ? { currency: account.currency } : {}),
            ...(account.timezone ? { timezone: account.timezone } : {}),
            ...(account.status ? { status: account.status } : {}),
            ...(account.metadata ? { metadata: account.metadata } : {}),
            lastSeenAt: new Date(),
          },
        });
      }
      await tx.providerConnection.update({
        where: { id: connectionId },
        data: {
          status: "CONNECTED",
          lastSuccessAt: new Date(),
          lastErrorAt: null,
          lastErrorCode: null,
        },
      });
    });
    return accounts;
  }

  private async connectionWithCredential(
    workspaceId: string,
    connectionId: string,
  ) {
    const connection = await this.database.client.providerConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { credential: true },
    });
    if (!connection)
      throw new NotFoundException("Provider connection not found.");
    if (
      connection.status === "DISCONNECTED" ||
      connection.status === "REVOKED"
    ) {
      throw new ForbiddenException("Provider connection is disconnected.");
    }
    return connection;
  }

  private connectionWithAccounts(workspaceId: string, connectionId: string) {
    return this.database.client.providerConnection.findFirstOrThrow({
      where: { id: connectionId, workspaceId },
      include: { accounts: { orderBy: { displayName: "asc" } } },
    });
  }

  private toView(
    connection: Prisma.ProviderConnectionGetPayload<{
      include: { accounts: { orderBy: { displayName: "asc" } } };
    }>,
  ): ProviderConnectionView {
    const scopes = this.scopeMetadataFromJson(connection.metadata);
    return {
      id: connection.id,
      workspaceId: connection.workspaceId,
      provider: connection.provider as ProviderId,
      status: connection.status,
      displayName: connection.displayName,
      connectedAt: toIso(connection.connectedAt),
      disconnectedAt: toIso(connection.disconnectedAt),
      lastSuccessAt: toIso(connection.lastSuccessAt),
      lastErrorCode: connection.lastErrorCode,
      credentialVersion: connection.credentialVersion,
      ...scopes,
      accounts: (connection.accounts ?? []).map((account) =>
        this.accountView(account),
      ),
    };
  }

  private accountView(
    account: Prisma.ProviderAccountGetPayload<object>,
  ): ProviderAccountView {
    return {
      id: account.id,
      provider: account.provider as ProviderId,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
      currency: account.currency,
      timezone: account.timezone,
      status: account.status,
      enabled: account.enabled,
      discoveredAt: account.discoveredAt.toISOString(),
      lastSeenAt: account.lastSeenAt.toISOString(),
    };
  }

  private scopeMetadata(
    requestedScopes: string[],
    grantedScopes: string[],
  ): ProviderScopeMetadata {
    return {
      requestedScopes,
      grantedScopes,
      missingScopes: requestedScopes.filter(
        (scope) => !grantedScopes.includes(scope),
      ),
    };
  }

  private scopeMetadataFromJson(metadata: unknown): ProviderScopeMetadata {
    const value = metadata as Partial<ProviderScopeMetadata> | null;
    return {
      requestedScopes: Array.isArray(value?.requestedScopes)
        ? value.requestedScopes.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      grantedScopes: Array.isArray(value?.grantedScopes)
        ? value.grantedScopes.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      missingScopes: Array.isArray(value?.missingScopes)
        ? value.missingScopes.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  }

  private redirectUri(provider: ProviderId): string {
    if (provider === "GOOGLE_ADS" && this.config.providerGoogleRedirectUri)
      return this.config.providerGoogleRedirectUri;
    if (provider === "META_ADS" && this.config.providerMetaRedirectUri)
      return this.config.providerMetaRedirectUri;
    return `http://localhost:${this.config.apiPort}/api/v1/oauth/${provider}/callback`;
  }

  private async record(
    eventType: string,
    request: RequestWithAuth,
    principal: HumanPrincipal,
    workspaceId?: string,
    provider?: ProviderId,
    targetId?: string,
    error?: unknown,
  ) {
    await this.audit.record({
      eventType,
      actorUserId: principal.userId,
      ...(workspaceId ? { workspaceId } : {}),
      ...(provider
        ? { targetType: "provider", targetId: targetId ?? provider }
        : {}),
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...(error
        ? {
            success: false,
            metadata: {
              code:
                error instanceof ProviderError ? error.code : "provider_error",
            },
          }
        : {}),
    });
  }
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
