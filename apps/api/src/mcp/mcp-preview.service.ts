import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import type { Prisma } from "@holymedia/database";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
import { ProviderService } from "../providers/provider.service.js";

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
    @Inject(ProviderService) private readonly providers: ProviderService,
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
    const policyReason = this.commitPolicyReason(preview, account);
    const confirmedWriteAvailable =
      principal.scopes.includes(WRITE_SCOPE) && !policyReason;
    const providerRequest = this.providerRequest(
      input,
      preview.externalObjectId,
    );
    return {
      status: "preview",
      mode: confirmedWriteAvailable ? "preview_confirm" : "preview_only",
      preview_token: previewToken,
      expires_at: expiresAt.toISOString(),
      provider: input.provider,
      account_id: account.externalAccountId,
      object_id: input.objectId.trim(),
      operation: input.operation,
      diff,
      provider_request: providerRequest,
      risk_flags: ["explicit_confirmation_required", "server_side_policy"],
      execution_mode: "simulated_no_write",
      confirmed_write_available: confirmedWriteAvailable,
      app_review_commit_available: confirmedWriteAvailable,
      commit_available_after_confirmation: confirmedWriteAvailable,
      commit_tool: confirmedWriteAvailable
        ? "commit_meta_confirmed_write"
        : null,
      required_oauth_permission:
        input.provider === "META_ADS" ? "ads_management" : null,
      write_readiness: confirmedWriteAvailable
        ? "ready_after_explicit_confirmation"
        : this.writeReadiness(principal, policyReason),
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

    const account = await this.account(principal, preview.accountId);
    const policyReason = this.commitPolicyReason(preview, account);
    const consumed = await this.database.client.mcpPreview.updateMany({
      where: { id: preview.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new ForbiddenException("Preview has already been consumed.");
    if (policyReason) {
      await this.audit.record({
        eventType: "mcp_commit_blocked",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: { reason: policyReason },
      });
      return {
        status: "blocked",
        preview_token: "redacted",
        execution_mode: "simulated_no_write",
        preview_only: this.config.previewOnly,
        provider_write_enabled: false,
        reread: null,
        reason: policyReason,
        message: this.policyMessage(policyReason),
      };
    }
    try {
      const payload =
        preview.payload &&
        typeof preview.payload === "object" &&
        !Array.isArray(preview.payload)
          ? (preview.payload as Record<string, unknown>)
          : {};
      const committed = await this.providers.mutateCampaign(
        principal.workspaceId,
        account.connectionId,
        account.id,
        preview.externalObjectId,
        preview.operation as "change_name" | "pause" | "resume",
        payload,
      );
      await this.audit.record({
        eventType: "mcp_commit_completed",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        metadata: {
          provider: preview.provider,
          operation: preview.operation,
        },
      });
      return {
        status: "committed",
        preview_token: "redacted",
        execution_mode: "confirmed_write",
        provider_write_enabled: true,
        reread: committed.reread,
      };
    } catch (error) {
      await this.audit.record({
        eventType: "mcp_commit_failed",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: { provider: preview.provider, operation: preview.operation },
      });
      throw error;
    }
  }

  private commitPolicyReason(
    preview: { provider: string; operation: string; externalObjectId: string },
    account: { id: string; externalAccountId: string },
  ): string | null {
    if (this.config.previewOnly) return "preview_only";
    if (!this.config.confirmedWriteEnabled) return "confirmed_write_disabled";
    if (preview.provider !== "META_ADS") return "provider_write_unavailable";
    if (!this.config.writeOperationAllowlist.includes(preview.operation))
      return "operation_not_allowlisted";
    if (!this.config.writeObjectAllowlist.includes(preview.externalObjectId))
      return "object_not_allowlisted";
    if (
      !this.config.writeAccountAllowlist.includes(account.id) &&
      !this.config.writeAccountAllowlist.includes(account.externalAccountId)
    )
      return "account_not_allowlisted";
    if (!["change_name", "pause", "resume"].includes(preview.operation))
      return "operation_not_supported";
    return null;
  }

  private providerRequest(input: PreviewInput, objectId: string) {
    if (input.provider === "META_ADS" && input.operation === "change_name") {
      const name =
        typeof input.payload.new_name === "string"
          ? input.payload.new_name.trim()
          : "";
      return {
        http_method: "POST",
        endpoint: `/${objectId}`,
        body: { name },
      };
    }
    return null;
  }

  private writeReadiness(
    principal: ServiceTokenPrincipal,
    policyReason: string | null,
  ): string {
    if (!principal.scopes.includes(WRITE_SCOPE))
      return "service_token_write_scope_required";
    return policyReason ?? "provider_permission_check_required";
  }

  private policyMessage(reason: string) {
    const messages: Record<string, string> = {
      preview_only:
        "Confirmed Meta writes are disabled while V2_PREVIEW_ONLY is enabled.",
      confirmed_write_disabled:
        "Confirmed Meta writes are not enabled for this environment.",
      provider_write_unavailable:
        "Confirmed writes are available only for Meta Ads.",
      operation_not_allowlisted:
        "This Meta operation is not allowlisted for confirmed writes.",
      object_not_allowlisted:
        "This campaign is not allowlisted for confirmed writes.",
      account_not_allowlisted:
        "This ad account is not allowlisted for confirmed writes.",
      operation_not_supported:
        "This Meta operation is not supported for confirmed writes.",
    };
    return (
      messages[reason] ?? "Confirmed Meta write was blocked by server policy."
    );
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
