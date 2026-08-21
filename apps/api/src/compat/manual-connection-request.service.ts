import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ProviderService } from "../providers/provider.service.js";
import type {
  CreateManualMetaConnectionRequestDto,
  UpdateManualConnectionRequestDto,
} from "./manual-connection-request.dto.js";

const secretKeyPattern =
  /access[\s_-]?token|page[\s_-]?access|app[\s_-]?secret|client[\s_-]?secret|password|bearer\s+|(?:EA|sk-|GOCSPX-)[A-Za-z0-9_\-|]{16,}/i;

const statusMap = {
  new: "NEW",
  in_progress: "IN_PROGRESS",
  waiting_for_client: "WAITING_FOR_CLIENT",
  ready_for_connection: "READY_FOR_CONNECTION",
  completed: "COMPLETED",
  cancelled: "CANCELED",
} as const;

const supportPermission = "support.connection_requests.manage";

@Injectable()
export class ManualConnectionRequestService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProviderService) private readonly providers: ProviderService,
  ) {}

  public async listForUser(principal: HumanPrincipal) {
    const rows = await this.database.client.manualConnectionRequest.findMany({
      where: { userId: principal.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { requests: rows.map((row) => this.view(row)) };
  }

  public async create(
    workspaceId: string,
    principal: HumanPrincipal,
    input: CreateManualMetaConnectionRequestDto,
    request: RequestWithAuth,
  ) {
    const note = input.client_note?.trim() ?? "";
    if (secretKeyPattern.test(note))
      throw new BadRequestException(
        "Заявка не принимает пароли, токены или секреты.",
      );
    const existing =
      await this.database.client.manualConnectionRequest.findFirst({
        where: {
          workspaceId,
          userId: principal.userId,
          provider: "META_ADS",
          status: { notIn: ["COMPLETED", "CANCELED"] },
        },
        orderBy: { createdAt: "desc" },
      });
    if (existing) return { ...this.view(existing), created: false };

    const accountId = input.ad_account_id.startsWith("act_")
      ? input.ad_account_id
      : `act_${input.ad_account_id}`;
    const row = await this.database.client.manualConnectionRequest.create({
      data: {
        workspaceId,
        userId: principal.userId,
        provider: "META_ADS",
        companyName: input.company_name?.trim() || "HolyMedia client",
        metaAdAccountId: accountId,
        contactPreference: input.contact_preference ?? "email",
        clientNote: note,
        ...(input.business_id ? { metaBusinessId: input.business_id } : {}),
        ...(input.page_id ? { metaPageId: input.page_id } : {}),
        ...(input.instagram_username
          ? {
              instagramUsername: input.instagram_username
                .replace(/^@/, "")
                .toLowerCase(),
            }
          : {}),
      },
    });
    await this.audit.record({
      eventType: "manual_connection_request_created",
      actorUserId: principal.userId,
      workspaceId,
      targetType: "manual_connection_request",
      targetId: row.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { provider: "META_ADS", accountId },
    });
    return { ...this.view(row), created: true };
  }

  public async listForAdmin(principal: HumanPrincipal) {
    const supportAccess = await this.hasSupportAccess(principal.userId);
    const memberships = await this.database.client.workspaceMembership.findMany(
      {
        where: { userId: principal.userId, role: { in: ["OWNER", "ADMIN"] } },
        select: { workspaceId: true },
      },
    );
    if (!supportAccess && memberships.length === 0)
      throw new ForbiddenException("Support access required.");
    const rows = await this.database.client.manualConnectionRequest.findMany({
      ...(supportAccess
        ? {}
        : {
            where: {
              workspaceId: {
                in: memberships.map((item) => item.workspaceId),
              },
            },
          }),
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    });
    return {
      requests: rows.map((row) => this.view(row)),
      support_access: supportAccess,
    };
  }

  public async update(
    principal: HumanPrincipal,
    requestId: string,
    input: UpdateManualConnectionRequestDto,
    request: RequestWithAuth,
  ) {
    const current = await this.authorizedRequest(principal, requestId);
    const row = await this.database.client.manualConnectionRequest.update({
      where: { id: current.id },
      data: {
        status: statusMap[input.status as keyof typeof statusMap],
        specialistNote: input.specialist_note?.trim() ?? "",
        assignedTo: principal.userId,
      },
    });
    await this.audit.record({
      eventType: "manual_connection_request_updated",
      actorUserId: principal.userId,
      workspaceId: current.workspaceId,
      targetType: "manual_connection_request",
      targetId: current.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { status: input.status },
    });
    return { request: this.view(row) };
  }

  public async authorizeMeta(
    principal: HumanPrincipal,
    requestId: string,
    request: RequestWithAuth,
  ) {
    const current = await this.authorizedRequest(principal, requestId);
    const started = await this.providers.startOAuth(
      current.workspaceId,
      "META_ADS",
      principal,
      request,
    );
    await this.database.client.manualConnectionRequest.update({
      where: { id: current.id },
      data: { status: "IN_PROGRESS", assignedTo: principal.userId },
    });
    await this.audit.record({
      eventType: "manual_connection_oauth_started",
      actorUserId: principal.userId,
      workspaceId: current.workspaceId,
      targetType: "manual_connection_request",
      targetId: current.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { provider: "META_ADS" },
    });
    return {
      request_id: current.id,
      authorization_url: started.authorizationUrl,
    };
  }

  public async pendingMeta(principal: HumanPrincipal, requestId: string) {
    const current = await this.authorizedRequest(principal, requestId);
    const connection = await this.database.client.providerConnection.findFirst({
      where: { workspaceId: current.workspaceId, provider: "META_ADS" },
      include: { accounts: { orderBy: { displayName: "asc" } } },
    });
    return {
      request_id: current.id,
      pending: (connection?.accounts ?? []).map((account) => ({
        id: account.id,
        external_account_id: account.externalAccountId,
        name: account.displayName,
        status: account.status,
        enabled: account.enabled,
      })),
      data_status: connection ? "live" : "empty",
      source_api: "v2_provider_framework",
      real_data: Boolean(connection),
      fetched_at: new Date().toISOString(),
    };
  }

  public async selectMeta(
    principal: HumanPrincipal,
    requestId: string,
    pendingId: string,
    request: RequestWithAuth,
  ) {
    const current = await this.authorizedRequest(principal, requestId);
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId: current.workspaceId,
        provider: "META_ADS",
        OR: [{ id: pendingId }, { externalAccountId: pendingId }],
      },
    });
    if (!account) throw new NotFoundException("Meta account is not available.");
    const selected = await this.database.client.providerAccount.update({
      where: { id: account.id },
      data: { enabled: true },
    });
    await this.database.client.manualConnectionRequest.update({
      where: { id: current.id },
      data: { status: "COMPLETED", assignedTo: principal.userId },
    });
    await this.audit.record({
      eventType: "manual_connection_account_selected",
      actorUserId: principal.userId,
      workspaceId: current.workspaceId,
      targetType: "provider_account",
      targetId: selected.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { provider: "META_ADS" },
    });
    return {
      request_id: current.id,
      account: {
        id: selected.id,
        external_account_id: selected.externalAccountId,
        name: selected.displayName,
        enabled: selected.enabled,
      },
    };
  }

  private async authorizedRequest(
    principal: HumanPrincipal,
    requestId: string,
  ) {
    const current =
      await this.database.client.manualConnectionRequest.findUnique({
        where: { id: requestId },
      });
    if (!current) throw new NotFoundException("Connection request not found.");
    if (await this.hasSupportAccess(principal.userId)) return current;
    const membership =
      await this.database.client.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: current.workspaceId,
            userId: principal.userId,
          },
        },
        select: { role: true },
      });
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role))
      throw new ForbiddenException("Admin access required.");
    return current;
  }

  private async hasSupportAccess(userId: string): Promise<boolean> {
    const grant = await this.database.client.userPermissionGrant.findFirst({
      where: {
        userId,
        revokedAt: null,
        permission: { key: supportPermission },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    return Boolean(grant);
  }

  private view(row: {
    id: string;
    workspaceId: string;
    userId: string;
    provider: string;
    companyName: string;
    metaBusinessId: string | null;
    metaAdAccountId: string;
    metaPageId: string | null;
    instagramUsername: string | null;
    contactPreference: string;
    clientNote: string;
    status: string;
    specialistNote: string;
    assignedTo: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      workspace_id: row.workspaceId,
      user_id: row.userId,
      provider: row.provider.toLowerCase(),
      company_name: row.companyName,
      meta_business_id: row.metaBusinessId,
      meta_ad_account_id: row.metaAdAccountId,
      meta_page_id: row.metaPageId,
      instagram_username: row.instagramUsername,
      contact_preference: row.contactPreference,
      client_note: row.clientNote,
      status: row.status.toLowerCase(),
      specialist_note: row.specialistNote,
      assigned_to: row.assignedTo,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
