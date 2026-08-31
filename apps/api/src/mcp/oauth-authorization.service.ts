import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";

export const OAUTH_ISSUER = "https://mcp.holymedia.kz";
export const MCP_RESOURCE = `${OAUTH_ISSUER}/mcp`;
export const MCP_READ_SCOPE = "adforge:mcp:read";

const TRANSACTION_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 3 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;

@Injectable()
export class OAuthAuthorizationService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public async registerPublicClient(input: Record<string, unknown>) {
    const redirectUris = stringArray(input.redirect_uris);
    if (
      redirectUris.length === 0 ||
      redirectUris.length > 10 ||
      redirectUris.some((uri) => !validRedirectUri(uri))
    ) {
      throw new BadRequestException("OAuth redirect_uris are invalid.");
    }
    const authenticationMethod =
      stringValue(input.token_endpoint_auth_method) || "none";
    if (authenticationMethod !== "none") {
      throw new BadRequestException(
        "Public OAuth clients must use token_endpoint_auth_method=none.",
      );
    }
    const grantTypes = stringArray(input.grant_types);
    const responseTypes = stringArray(input.response_types);
    if (
      (grantTypes.length > 0 && !grantTypes.includes("authorization_code")) ||
      (responseTypes.length > 0 && !responseTypes.includes("code"))
    ) {
      throw new BadRequestException(
        "Only the authorization_code flow is supported.",
      );
    }
    const clientName =
      stringValue(input.client_name).slice(0, 160) || "Public MCP client";
    const clientId = `hm_public_${randomBytes(24).toString("base64url")}`;
    const client = await this.database.client.oAuthPublicClient.create({
      data: {
        clientId,
        clientName,
        redirectUris,
        scope: normalizeScope(stringValue(input.scope)),
        tokenEndpointAuthMethod: "none",
      },
    });
    return {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: client.scope,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    };
  }

  public async isPublicClient(clientId: string): Promise<boolean> {
    if (!clientId) return false;
    return Boolean(
      await this.database.client.oAuthPublicClient.findFirst({
        where: { clientId, status: "active", revokedAt: null },
        select: { id: true },
      }),
    );
  }

  public async beginAuthorization(
    input: Record<string, unknown>,
    principal?: HumanPrincipal,
  ) {
    const clientId = required(input.client_id, "client_id");
    const redirectUri = required(input.redirect_uri, "redirect_uri");
    const responseType = required(input.response_type, "response_type");
    const codeChallenge = required(input.code_challenge, "code_challenge");
    const method = required(
      input.code_challenge_method,
      "code_challenge_method",
    );
    const resource = stringValue(input.resource) || MCP_RESOURCE;
    if (responseType !== "code") {
      throw new BadRequestException("Only response_type=code is supported.");
    }
    if (method !== "S256" || !validPkceChallenge(codeChallenge)) {
      throw new BadRequestException("A valid S256 PKCE challenge is required.");
    }
    if (resource !== MCP_RESOURCE) {
      throw new BadRequestException("OAuth resource is invalid.");
    }
    const client = await this.database.client.oAuthPublicClient.findFirst({
      where: { clientId, status: "active", revokedAt: null },
    });
    if (!client || !jsonStrings(client.redirectUris).includes(redirectUri)) {
      throw new BadRequestException("OAuth client or redirect URI is invalid.");
    }
    const scope = normalizeScope(stringValue(input.scope));
    const workspaceId = principal
      ? await this.firstWorkspaceId(principal.userId)
      : null;
    const transaction =
      await this.database.client.oAuthAuthorizationTransaction.create({
        data: {
          clientId: client.id,
          redirectUri,
          state: stringValue(input.state) || null,
          scope,
          resource,
          codeChallenge,
          codeChallengeMethod: "S256",
          userId: principal?.userId ?? null,
          workspaceId,
          expiresAt: new Date(Date.now() + TRANSACTION_TTL_MS),
        },
      });

    const target = principal
      ? `${OAUTH_ISSUER}/oauth/authorize/continue?transaction=${encodeURIComponent(transaction.id)}`
      : `${OAUTH_ISSUER}/auth?oauth_transaction=${encodeURIComponent(transaction.id)}`;
    return { url: target, statusCode: 302, transaction_id: transaction.id };
  }

  public async continueAuthorization(
    transactionId: string,
    principal: HumanPrincipal,
    workspaceId?: string,
  ) {
    const transaction = await this.activeTransaction(transactionId);
    const selectedWorkspaceId =
      workspaceId ||
      transaction.workspaceId ||
      (await this.firstWorkspaceId(principal.userId));
    await this.requireWorkspaceMembership(
      principal.userId,
      selectedWorkspaceId,
    );
    const bound =
      await this.database.client.oAuthAuthorizationTransaction.update({
        where: { id: transaction.id },
        data: { userId: principal.userId, workspaceId: selectedWorkspaceId },
        include: {
          client: { select: { clientName: true, clientId: true } },
          workspace: { select: { id: true, name: true } },
        },
      });
    return {
      transaction_id: bound.id,
      client_id: bound.client.clientId,
      client_name: bound.client.clientName,
      workspace: bound.workspace,
      scope: bound.scope,
      resource: bound.resource,
      consent_required: true,
    };
  }

  public async decideAuthorization(
    transactionId: string,
    allow: boolean,
    principal: HumanPrincipal,
    workspaceId?: string,
  ) {
    const transaction = await this.activeTransaction(transactionId);
    if (transaction.userId && transaction.userId !== principal.userId) {
      throw new UnauthorizedException("OAuth transaction is not available.");
    }
    const selectedWorkspaceId =
      workspaceId ||
      transaction.workspaceId ||
      (await this.firstWorkspaceId(principal.userId));
    await this.requireWorkspaceMembership(
      principal.userId,
      selectedWorkspaceId,
    );

    const target = new URL(transaction.redirectUri);
    if (!allow) {
      const denied =
        await this.database.client.oAuthAuthorizationTransaction.updateMany({
          where: {
            id: transaction.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: {
            consumedAt: new Date(),
            userId: principal.userId,
            workspaceId: selectedWorkspaceId,
          },
        });
      if (denied.count !== 1) {
        throw new BadRequestException(
          "OAuth transaction is invalid or expired.",
        );
      }
      target.searchParams.set("error", "access_denied");
      if (transaction.state)
        target.searchParams.set("state", transaction.state);
      return { url: target.toString(), statusCode: 302 };
    }

    const rawCode = `hm_code_${randomBytes(32).toString("base64url")}`;
    await this.database.client.$transaction(async (database) => {
      const consumed = await database.oAuthAuthorizationTransaction.updateMany({
        where: {
          id: transaction.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          consumedAt: new Date(),
          userId: principal.userId,
          workspaceId: selectedWorkspaceId,
        },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(
          "OAuth transaction is invalid or expired.",
        );
      }
      await database.oAuthAuthorizationCode.create({
        data: {
          codeDigest: digest(rawCode),
          clientId: transaction.clientId,
          workspaceId: selectedWorkspaceId,
          userId: principal.userId,
          redirectUri: transaction.redirectUri,
          scope: transaction.scope,
          resource: transaction.resource,
          codeChallenge: transaction.codeChallenge,
          codeChallengeMethod: transaction.codeChallengeMethod,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      });
    });
    target.searchParams.set("code", rawCode);
    if (transaction.state) target.searchParams.set("state", transaction.state);
    return { url: target.toString(), statusCode: 302 };
  }

  public async exchangeAuthorizationCode(input: Record<string, unknown>) {
    if (required(input.grant_type, "grant_type") !== "authorization_code") {
      throw new BadRequestException("Unsupported OAuth grant type.");
    }
    const clientId = required(input.client_id, "client_id");
    const rawCode = required(input.code, "code");
    const redirectUri = required(input.redirect_uri, "redirect_uri");
    const verifier = required(input.code_verifier, "code_verifier");
    const resource = stringValue(input.resource) || MCP_RESOURCE;
    if (!validPkceVerifier(verifier) || resource !== MCP_RESOURCE) {
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    }
    const client = await this.database.client.oAuthPublicClient.findFirst({
      where: {
        clientId,
        status: "active",
        revokedAt: null,
        tokenEndpointAuthMethod: "none",
      },
    });
    const code = client
      ? await this.database.client.oAuthAuthorizationCode.findFirst({
          where: { codeDigest: digest(rawCode), clientId: client.id },
        })
      : null;
    if (
      !client ||
      !code ||
      code.usedAt ||
      code.expiresAt <= new Date() ||
      code.redirectUri !== redirectUri ||
      code.resource !== resource ||
      !pkceMatches(verifier, code.codeChallenge)
    ) {
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    }

    const rawToken = `hm_oauth_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    await this.database.client.$transaction(async (database) => {
      const consumed = await database.oAuthAuthorizationCode.updateMany({
        where: { id: code.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException("OAuth authorization code is invalid.");
      }
      await database.oAuthAccessToken.create({
        data: {
          tokenDigest: digest(rawToken),
          tokenPrefix: rawToken.slice(0, 20),
          clientId: client.id,
          workspaceId: code.workspaceId,
          userId: code.userId,
          scope: code.scope,
          resource: code.resource,
          expiresAt,
        },
      });
    });
    return {
      access_token: rawToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: code.scope,
    };
  }

  public async authenticate(
    rawToken: string,
  ): Promise<ServiceTokenPrincipal | null> {
    if (!rawToken.startsWith("hm_oauth_")) return null;
    const token = await this.database.client.oAuthAccessToken.findUnique({
      where: { tokenDigest: digest(rawToken) },
      include: {
        client: { select: { status: true, revokedAt: true } },
        workspace: { select: { accessStatus: true } },
        user: { select: { status: true } },
      },
    });
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt <= new Date() ||
      token.resource !== MCP_RESOURCE ||
      token.client.status !== "active" ||
      token.client.revokedAt ||
      token.workspace.accessStatus !== "ACTIVE" ||
      token.user.status !== "active"
    ) {
      return null;
    }
    const membership =
      await this.database.client.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: token.workspaceId,
            userId: token.userId,
          },
        },
        select: { id: true },
      });
    if (!membership) return null;
    await this.database.client.oAuthAccessToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      kind: "service",
      tokenId: token.id,
      serviceIdentityId: `oauth:${token.clientId}:${token.userId}`,
      workspaceId: token.workspaceId,
      scopes: token.scope.split(/\s+/).filter(Boolean),
      accountIds: [],
    };
  }

  private async activeTransaction(transactionId: string) {
    const transaction =
      await this.database.client.oAuthAuthorizationTransaction.findFirst({
        where: {
          id: transactionId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
    if (!transaction) {
      throw new BadRequestException("OAuth transaction is invalid or expired.");
    }
    return transaction;
  }

  private async firstWorkspaceId(userId: string): Promise<string> {
    const membership = await this.database.client.workspaceMembership.findFirst(
      {
        where: { userId, workspace: { accessStatus: "ACTIVE" } },
        orderBy: { createdAt: "asc" },
        select: { workspaceId: true },
      },
    );
    if (!membership) {
      throw new BadRequestException("Workspace is not available.");
    }
    return membership.workspaceId;
  }

  private async requireWorkspaceMembership(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const membership = await this.database.client.workspaceMembership.findFirst(
      {
        where: {
          userId,
          workspaceId,
          workspace: { accessStatus: "ACTIVE" },
        },
        select: { id: true },
      },
    );
    if (!membership) {
      throw new UnauthorizedException("Workspace access denied.");
    }
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function required(value: unknown, name: string): string {
  const result = stringValue(value);
  if (!result) throw new BadRequestException(`OAuth ${name} is required.`);
  return result;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeScope(value: string): string {
  if (!value || value === "adforge:mcp" || value === MCP_READ_SCOPE) {
    return MCP_READ_SCOPE;
  }
  throw new BadRequestException("Only read-only MCP scope is available.");
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validPkceChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function validPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function pkceMatches(verifier: string, challenge: string): boolean {
  return (
    createHash("sha256").update(verifier, "utf8").digest("base64url") ===
    challenge
  );
}
