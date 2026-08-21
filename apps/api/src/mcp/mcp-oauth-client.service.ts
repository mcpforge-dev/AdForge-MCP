import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const READ_SCOPE = "adforge:mcp:read";

@Injectable()
export class McpOAuthClientService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  public async summary(principal: HumanPrincipal) {
    const workspace = await this.workspace(principal);
    const client = await this.database.client.mcpOAuthClient.findFirst({
      where: { workspaceId: workspace.id, userId: principal.userId },
      orderBy: { createdAt: "desc" },
    });
    return { exists: Boolean(client), ...(client ? this.view(client) : {}) };
  }

  public async create(
    principal: HumanPrincipal,
    request: RequestWithAuth,
    clientName = "Claude.ai connector",
  ) {
    const workspace = await this.workspace(principal);
    const clientId = `holymedia_claude_${randomBytes(18).toString("hex")}`;
    const clientSecret = `mcp_oauth_secret_${randomBytes(32).toString("base64url")}`;
    const client = await this.database.client.$transaction(async (tx) => {
      await tx.mcpOAuthClient.updateMany({
        where: {
          workspaceId: workspace.id,
          userId: principal.userId,
          status: "active",
        },
        data: { status: "revoked", revokedAt: new Date() },
      });
      return tx.mcpOAuthClient.create({
        data: {
          clientId,
          workspaceId: workspace.id,
          userId: principal.userId,
          clientName: clientName.trim().slice(0, 160) || "Claude.ai connector",
          redirectUris: [REDIRECT_URI],
          scope: READ_SCOPE,
          tokenEndpointAuthMethod: "client_secret_basic",
          clientSecretDigest: digest(clientSecret),
          clientSecretPrefix: clientSecret.slice(0, 22),
        },
      });
    });
    await this.audit.record({
      eventType: "mcp_oauth_client_created",
      actorUserId: principal.userId,
      workspaceId: workspace.id,
      targetType: "mcp_oauth_client",
      targetId: client.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
    return { client: this.view(client), client_secret: clientSecret };
  }

  public async authorize(
    input: Record<string, unknown>,
    principal: HumanPrincipal,
  ) {
    const clientId = stringValue(input.client_id);
    const redirectUri = stringValue(input.redirect_uri);
    const state = stringValue(input.state);
    const codeChallenge = stringValue(input.code_challenge);
    const responseType = stringValue(input.response_type);
    const method = stringValue(input.code_challenge_method) || "S256";
    if (responseType && responseType !== "code")
      throw new BadRequestException("Only response_type=code is supported.");
    if (!clientId || !redirectUri || !codeChallenge)
      throw new BadRequestException(
        "OAuth client_id, redirect_uri and PKCE are required.",
      );
    if (method !== "S256")
      throw new BadRequestException("Only S256 PKCE is supported.");
    const scope = normalizeScope(stringValue(input.scope));
    const workspace = await this.workspace(principal);
    const client = await this.database.client.mcpOAuthClient.findFirst({
      where: {
        clientId,
        workspaceId: workspace.id,
        userId: principal.userId,
        status: "active",
      },
    });
    if (!client || !redirectUris(client.redirectUris).includes(redirectUri))
      throw new BadRequestException("OAuth client or redirect URI is invalid.");
    const rawCode = `mcp_code_${randomBytes(32).toString("base64url")}`;
    await this.database.client.mcpOAuthAuthorizationCode.create({
      data: {
        codeDigest: digest(rawCode),
        clientId: client.id,
        workspaceId: workspace.id,
        userId: principal.userId,
        sessionId: principal.sessionId,
        redirectUri,
        scope,
        codeChallenge,
        codeChallengeMethod: method,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", rawCode);
    if (state) target.searchParams.set("state", state);
    return { url: target.toString(), statusCode: 302 };
  }

  public async token(input: Record<string, unknown>, authorization?: string) {
    const basic = parseBasic(authorization);
    const clientId = stringValue(input.client_id) || basic?.clientId;
    const clientSecret =
      stringValue(input.client_secret) || basic?.clientSecret;
    const code = stringValue(input.code);
    const redirectUri = stringValue(input.redirect_uri);
    const verifier = stringValue(input.code_verifier);
    if (!clientId || !clientSecret || !code || !redirectUri || !verifier)
      throw new UnauthorizedException("OAuth token request is invalid.");
    if (stringValue(input.grant_type) !== "authorization_code")
      throw new BadRequestException("Unsupported OAuth grant type.");
    const client = await this.database.client.mcpOAuthClient.findFirst({
      where: { clientId, status: "active" },
    });
    if (!client || digest(clientSecret) !== client.clientSecretDigest)
      throw new UnauthorizedException("OAuth client authentication failed.");
    const authCode =
      await this.database.client.mcpOAuthAuthorizationCode.findFirst({
        where: { codeDigest: digest(code), clientId: client.id },
      });
    if (
      !authCode ||
      authCode.usedAt ||
      authCode.expiresAt <= new Date() ||
      authCode.redirectUri !== redirectUri ||
      !pkceMatches(verifier, authCode.codeChallenge)
    )
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    const consumed =
      await this.database.client.mcpOAuthAuthorizationCode.updateMany({
        where: { id: authCode.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    if (consumed.count !== 1)
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    const principal: HumanPrincipal = {
      kind: "human",
      userId: authCode.userId,
      sessionId: authCode.sessionId,
    };
    const token = await this.tokens.create(
      authCode.workspaceId,
      {
        name: `MCP OAuth: ${client.clientName}`,
        scopes: [READ_SCOPE],
        expiresInDays: 90,
      },
      principal,
      {} as RequestWithAuth,
    );
    return {
      access_token: token.token,
      token_type: "Bearer",
      expires_in: 90 * 24 * 60 * 60,
      scope: READ_SCOPE,
    };
  }

  private async workspace(principal: HumanPrincipal) {
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace)
      throw new BadRequestException("Workspace is not available.");
    return workspace;
  }

  private view(client: {
    clientId: string;
    clientName: string;
    redirectUris: unknown;
    scope: string;
    status: string;
    createdAt: Date;
    revokedAt: Date | null;
    clientSecretPrefix: string;
  }) {
    return {
      exists: true,
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: redirectUris(client.redirectUris),
      scope: client.scope,
      status: client.status,
      client_secret_prefix: client.clientSecretPrefix,
      created_at: client.createdAt.toISOString(),
      revoked_at: client.revokedAt?.toISOString() ?? null,
    };
  }
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScope(value: string): string {
  if (!value || value === "adforge:mcp" || value === READ_SCOPE)
    return READ_SCOPE;
  throw new BadRequestException("Only read-only MCP scope is available.");
}

function redirectUris(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseBasic(value: string | undefined) {
  if (!value?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(value.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return {
      clientId: decoded.slice(0, separator),
      clientSecret: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function pkceMatches(verifier: string, challenge: string): boolean {
  return (
    createHash("sha256").update(verifier, "utf8").digest("base64url") ===
    challenge
  );
}
