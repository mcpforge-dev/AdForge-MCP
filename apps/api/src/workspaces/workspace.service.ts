import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisRateLimitService } from "../infrastructure/redis-rate-limit.service.js";
import {
  createOpaqueToken,
  createSlug,
  digestToken,
  hashIp,
  normalizeEmail,
} from "../infrastructure/security.utils.js";
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
  CreateWorkspaceDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
} from "../auth/auth.dto.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { EmailService } from "../auth/email.service.js";

const allowedRoles = new Set(["ADMIN", "MEMBER", "VIEWER"]);
type EditableRole = "ADMIN" | "MEMBER" | "VIEWER";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  createdAt?: Date;
};
export type WorkspaceView = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
};
export type WorkspaceMember = {
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    emailVerifiedAt: Date | null;
  };
};
export type RoleChangeResult = { userId: string; role: EditableRole };
export type InvitationView = {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  expiresAt: Date;
};

@Injectable()
export class WorkspaceService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EmailService) private readonly emails: EmailService,
    @Inject(RedisRateLimitService)
    private readonly limits: RedisRateLimitService,
  ) {}

  public async listForUser(
    principal: HumanPrincipal,
  ): Promise<WorkspaceSummary[]> {
    const memberships = await this.database.client.workspaceMembership.findMany(
      {
        where: { userId: principal.userId },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          workspace: {
            select: { id: true, name: true, slug: true, createdAt: true },
          },
        },
      },
    );
    return memberships.map((membership) => ({
      ...membership.workspace,
      role: membership.role,
    }));
  }

  public async create(
    input: CreateWorkspaceDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<WorkspaceSummary> {
    const workspace = await this.database.client.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name: input.name.trim(),
          slug: `${createSlug(input.name)}-${createOpaqueToken().slice(0, 8)}`,
        },
      });
      await tx.workspaceMembership.create({
        data: {
          workspaceId: created.id,
          userId: principal.userId,
          role: "OWNER",
        },
      });
      return created;
    });
    await this.record({
      eventType: "workspace_created",
      request,
      actorUserId: principal.userId,
      workspaceId: workspace.id,
    });
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: "OWNER",
    };
  }

  public async get(workspaceId: string): Promise<WorkspaceView> {
    const workspace = await this.database.client.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!workspace) throw new NotFoundException("Workspace not found.");
    return workspace;
  }

  public async update(
    workspaceId: string,
    input: UpdateWorkspaceDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<WorkspaceView> {
    if (!input.name) return this.get(workspaceId);
    const workspace = await this.database.client.workspace.update({
      where: { id: workspaceId },
      data: { name: input.name.trim() },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await this.record({
      eventType: "workspace_updated",
      request,
      actorUserId: principal.userId,
      workspaceId: workspace.id,
    });
    return workspace;
  }

  public async members(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.database.client.workspaceMembership.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, emailVerifiedAt: true },
        },
      },
    });
  }

  public async changeRole(
    workspaceId: string,
    targetUserId: string,
    input: UpdateMemberRoleDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<RoleChangeResult> {
    if (!allowedRoles.has(input.role))
      throw new BadRequestException("Invalid workspace role.");
    const role = input.role as EditableRole;
    const actor = await this.memberRole(workspaceId, principal.userId);
    const target = await this.database.client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Member not found.");
    if (target.role === "OWNER" && actor !== "OWNER")
      throw new ForbiddenException("Only an owner can change an owner role.");
    if (role === "ADMIN" || role === "MEMBER" || role === "VIEWER") {
      if (target.role === "OWNER") {
        const owners = await this.database.client.workspaceMembership.count({
          where: { workspaceId, role: "OWNER" },
        });
        if (owners < 2)
          throw new ConflictException(
            "Workspace must keep at least one owner.",
          );
      }
      const updated = await this.database.client.workspaceMembership.update({
        where: { id: target.id },
        data: { role },
      });
      await this.record({
        eventType: "member_role_changed",
        request,
        actorUserId: principal.userId,
        workspaceId,
        targetType: "user",
        targetId: targetUserId,
        metadata: { role },
      });
      return { userId: updated.userId, role: updated.role as EditableRole };
    }
    throw new BadRequestException("Invalid workspace role.");
  }

  public async removeMember(
    workspaceId: string,
    targetUserId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<{ success: true }> {
    const actor = await this.memberRole(workspaceId, principal.userId);
    const target = await this.database.client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Member not found.");
    if (target.role === "OWNER") {
      if (actor !== "OWNER")
        throw new ForbiddenException("Only an owner can remove an owner.");
      const owners = await this.database.client.workspaceMembership.count({
        where: { workspaceId, role: "OWNER" },
      });
      if (owners < 2)
        throw new ConflictException("Workspace must keep at least one owner.");
    }
    if (targetUserId === principal.userId && target.role === "OWNER")
      throw new ConflictException("The last owner cannot leave the workspace.");
    await this.database.client.workspaceMembership.delete({
      where: { id: target.id },
    });
    await this.record({
      eventType: "member_removed",
      request,
      actorUserId: principal.userId,
      workspaceId,
      targetType: "user",
      targetId: targetUserId,
    });
    return { success: true };
  }

  public async createInvitation(
    workspaceId: string,
    input: CreateInvitationDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<InvitationView> {
    const email = normalizeEmail(input.email);
    const role = input.role ?? "MEMBER";
    if (!allowedRoles.has(role))
      throw new BadRequestException("Invalid invitation role.");
    await this.limits.consume(
      `v2:rl:invitation:ip:${hashIp(request.ip, this.config.sessionHashSecret) ?? "unknown"}`,
      20,
      900,
    );
    const existing = await this.database.client.workspaceMembership.findFirst({
      where: { workspaceId, user: { email } },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException("User is already a workspace member.");
    const token = createOpaqueToken();
    const invitation = await this.database.client.workspaceInvitation.create({
      data: {
        workspaceId,
        inviterId: principal.userId,
        email,
        role: role as "ADMIN" | "MEMBER" | "VIEWER",
        tokenDigest: digestToken(token, this.config.sessionHashSecret),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    await this.emails.sendInvitation(email, token);
    await this.record({
      eventType: "member_invited",
      request,
      actorUserId: principal.userId,
      workspaceId,
      targetType: "invitation",
      targetId: invitation.id,
    });
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as EditableRole,
      expiresAt: invitation.expiresAt,
    };
  }

  public async revokeInvitation(
    workspaceId: string,
    invitationId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const updated = await this.database.client.workspaceInvitation.updateMany({
      where: {
        id: invitationId,
        workspaceId,
        revokedAt: null,
        acceptedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1)
      throw new NotFoundException("Invitation not found.");
    await this.record({
      eventType: "invitation_revoked",
      request,
      actorUserId: principal.userId,
      workspaceId,
      targetType: "invitation",
      targetId: invitationId,
    });
    return { success: true };
  }

  public async acceptInvitation(
    input: AcceptInvitationDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const invitation =
      await this.database.client.workspaceInvitation.findUnique({
        where: {
          tokenDigest: digestToken(input.token, this.config.sessionHashSecret),
        },
      });
    if (
      !invitation ||
      invitation.revokedAt ||
      invitation.acceptedAt ||
      invitation.expiresAt <= new Date()
    )
      throw new BadRequestException("Invitation is invalid or expired.");
    const user = await this.database.client.user.findUnique({
      where: { id: principal.userId },
      select: { email: true },
    });
    if (!user || user.email !== invitation.email)
      throw new ForbiddenException(
        "Invitation email does not match the signed-in account.",
      );
    await this.database.client.$transaction(async (tx) => {
      const claimed = await tx.workspaceInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new ConflictException("Invitation was already used.");
      await tx.workspaceMembership.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: principal.userId,
          role: invitation.role,
        },
      });
    });
    await this.record({
      eventType: "invitation_accepted",
      request,
      actorUserId: principal.userId,
      workspaceId: invitation.workspaceId,
      targetType: "invitation",
      targetId: invitation.id,
    });
    return { success: true, workspaceId: invitation.workspaceId };
  }

  private async memberRole(workspaceId: string, userId: string) {
    const membership =
      await this.database.client.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      });
    if (!membership) throw new ForbiddenException("Workspace access denied.");
    return membership.role;
  }

  private async record(input: {
    eventType: string;
    request: RequestWithAuth;
    actorUserId?: string;
    workspaceId?: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }) {
    await this.audit.record({
      eventType: input.eventType,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.request.requestId
        ? { requestId: input.request.requestId }
        : {}),
    });
  }
}
