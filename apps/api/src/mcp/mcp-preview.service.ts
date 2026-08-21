import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import type { Prisma } from "@holymedia/database";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";

const READ_SCOPE = "adforge:mcp:read";
const WRITE_SCOPE = "adforge:mcp:write";
const OPERATIONS = new Set([
  "archive_entities",
  "archive_object",
  "change_budget",
  "change_name",
  "clone_ad",
  "clone_adset",
  "clone_campaign",
  "configure_schedule",
  "create_ab_test_ads",
  "create_ad",
  "create_ad_group",
  "create_adset",
  "create_audience",
  "create_audience_variant",
  "create_campaign",
  "create_creative",
  "create_keyword",
  "create_object",
  "pause",
  "replace_creative",
  "resume",
  "update_ad",
  "update_adset",
  "update_campaign",
  "update_object",
  "update_placements",
  "update_status",
  "update_targeting",
]);

type PreviewInput = {
  provider: "GOOGLE_ADS" | "META_ADS";
  accountId: string;
  objectId: string;
  operation: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class McpPreviewService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  public async create(principal: ServiceTokenPrincipal, input: PreviewInput) {
    this.ensureRead(principal);
    if (!OPERATIONS.has(input.operation))
      throw new ForbiddenException("This MCP operation is not available.");
    const account = await this.account(principal, input.accountId);
    if (account.provider !== input.provider)
      throw new ForbiddenException("Provider and account do not match.");

    const previewToken = `hmpp_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const diff = this.diff(input.operation, input.objectId, input.payload);
    const preview = await this.database.client.mcpPreview.create({
      data: {
        workspaceId: principal.workspaceId,
        serviceTokenId: principal.tokenId,
        provider: input.provider,
        accountId: account.id,
        externalObjectId: input.objectId.trim(),
        operation: input.operation,
        payload: input.payload as Prisma.InputJsonValue,
        diff: diff as Prisma.InputJsonValue,
        previewTokenDigest: digest(previewToken),
        expiresAt,
      },
    });
    await this.audit.record({
      eventType: "mcp_preview_created",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        provider: input.provider,
        operation: input.operation,
        accountRestricted: principal.accountIds.length > 0,
      },
    });
    return {
      status: "preview",
      preview_token: previewToken,
      expires_at: expiresAt.toISOString(),
      provider: input.provider,
      account_id: account.externalAccountId,
      object_id: input.objectId.trim(),
      operation: input.operation,
      diff,
      risk_flags: ["explicit_confirmation_required", "server_side_policy"],
      execution_mode: "simulated_no_write",
    };
  }

  public async confirm(principal: ServiceTokenPrincipal, previewToken: string) {
    this.ensureRead(principal);
    const preview = await this.find(principal, previewToken);
    if (preview.consumedAt)
      throw new ForbiddenException("Preview has already been consumed.");
    if (preview.expiresAt <= new Date())
      throw new ForbiddenException("Preview has expired.");
    if (preview.confirmedAt) return this.view(preview, "confirmed");
    const updated = await this.database.client.mcpPreview.update({
      where: { id: preview.id },
      data: { confirmedAt: new Date() },
    });
    await this.audit.record({
      eventType: "mcp_preview_confirmed",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
    });
    return this.view(updated, "confirmed");
  }

  public async commit(principal: ServiceTokenPrincipal, previewToken: string) {
    if (!principal.scopes.includes(WRITE_SCOPE))
      throw new ForbiddenException("Write scope is required for commit.");
    const preview = await this.find(principal, previewToken);
    if (preview.consumedAt)
      throw new ForbiddenException("Preview has already been consumed.");
    if (preview.expiresAt <= new Date())
      throw new ForbiddenException("Preview has expired.");
    if (!preview.confirmedAt)
      throw new ForbiddenException(
        "Explicit preview confirmation is required.",
      );

    const consumed = await this.database.client.mcpPreview.updateMany({
      where: { id: preview.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new ForbiddenException("Preview has already been consumed.");
    await this.audit.record({
      eventType: "mcp_commit_blocked",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      success: false,
      metadata: {
        reason: this.config.previewOnly
          ? "preview_only"
          : "provider_write_adapter_unavailable",
      },
    });
    return {
      status: "blocked",
      preview_token: "redacted",
      execution_mode: "simulated_no_write",
      preview_only: this.config.previewOnly,
      provider_write_enabled: false,
      reread: null,
      message:
        "HolyMedia MCP работает в режиме чтения и не изменяет рекламные кампании.",
    };
  }

  private async account(principal: ServiceTokenPrincipal, accountId: string) {
    const normalized = accountId.trim();
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        enabled: true,
        connection: { status: "CONNECTED" },
        ...(principal.accountIds.length
          ? { id: { in: principal.accountIds } }
          : {}),
        OR: [{ id: normalized }, { externalAccountId: normalized }],
      },
    });
    if (!account)
      throw new ForbiddenException(
        "Account is not available to this service token.",
      );
    if (account.provider !== "GOOGLE_ADS" && account.provider !== "META_ADS")
      throw new ForbiddenException(
        "This provider does not support campaign previews.",
      );
    return account;
  }

  private async find(principal: ServiceTokenPrincipal, previewToken: string) {
    const value = previewToken.trim();
    if (!/^hmpp_[A-Za-z0-9_-]{20,120}$/.test(value))
      throw new ForbiddenException("Preview token is invalid.");
    const preview = await this.database.client.mcpPreview.findFirst({
      where: {
        previewTokenDigest: digest(value),
        workspaceId: principal.workspaceId,
        serviceTokenId: principal.tokenId,
        ...(principal.accountIds.length
          ? { accountId: { in: principal.accountIds } }
          : {}),
      },
    });
    if (!preview) throw new ForbiddenException("Preview token is invalid.");
    return preview;
  }

  private diff(
    operation: string,
    objectId: string,
    payload: Record<string, unknown>,
  ) {
    if (operation === "change_name") {
      const newName =
        typeof payload.new_name === "string" ? payload.new_name.trim() : "";
      if (!newName || newName.length > 255)
        throw new ForbiddenException("new_name is required.");
      return {
        object_id: objectId.trim(),
        field: "name",
        before: null,
        after: newName,
      };
    }
    if (operation === "change_budget") {
      const budget = Number(payload.daily_budget);
      if (!Number.isFinite(budget) || budget < 0)
        throw new ForbiddenException("daily_budget is invalid.");
      return {
        object_id: objectId.trim(),
        field: "daily_budget",
        before: null,
        after: budget,
      };
    }
    if (operation === "pause" || operation === "resume") {
      return {
        object_id: objectId.trim(),
        field: "status",
        before: null,
        after: operation === "pause" ? "PAUSED" : "ENABLED",
      };
    }
    return {
      object_id: objectId.trim(),
      operation,
      before: null,
      after: payload,
    };
  }

  private view(
    preview: {
      id: string;
      operation: string;
      expiresAt: Date;
      confirmedAt: Date | null;
    },
    status: string,
  ) {
    return {
      status,
      preview_id: preview.id,
      operation: preview.operation,
      confirmed_at: preview.confirmedAt?.toISOString() ?? null,
      expires_at: preview.expiresAt.toISOString(),
    };
  }

  private ensureRead(principal: ServiceTokenPrincipal) {
    if (
      !principal.scopes.includes(READ_SCOPE) &&
      !principal.scopes.includes("adforge:mcp")
    )
      throw new ForbiddenException("Service token does not have read access.");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
