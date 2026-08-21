import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

type AdminBody = {
  user_id?: string;
  status?: string;
  role?: string;
  workspace_id?: string;
};

/** V1 admin facade with workspace-scoped authorization. */
@Controller("api/admin")
@UseGuards(AuthenticationGuard)
export class LegacyAdminController {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get("users")
  public async users(@CurrentPrincipal() principal: HumanPrincipal) {
    const workspaceIds = await this.adminWorkspaceIds(principal);
    const memberships = await this.database.client.workspaceMembership.findMany(
      {
        where: { workspaceId: { in: workspaceIds } },
        select: {
          userId: true,
          role: true,
          workspaceId: true,
          user: { select: { id: true, email: true, name: true, status: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    );
    const unique = new Map<string, (typeof memberships)[number]>();
    for (const membership of memberships)
      unique.set(membership.userId, membership);
    return {
      users: [...unique.values()].map((membership) => ({
        id: membership.user.id,
        email: membership.user.email,
        name: membership.user.name,
        status: membership.user.status,
        role: membership.role.toLowerCase(),
        workspace_id: membership.workspaceId,
      })),
    };
  }

  @Post("users/status")
  public async status(
    @Body() body: AdminBody,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const target = await this.target(
      principal,
      body.user_id,
      body.workspace_id,
      true,
    );
    const status = body.status?.trim().toLowerCase();
    if (status !== "active" && status !== "disabled") {
      throw new ForbiddenException("Unsupported user status.");
    }
    if (status === "disabled" && target.role === "OWNER") {
      const activeOwners = await this.database.client.workspaceMembership.count(
        {
          where: {
            workspaceId: target.workspaceId,
            role: "OWNER",
            user: { status: "active" },
          },
        },
      );
      if (activeOwners <= 1)
        throw new ForbiddenException("Workspace must keep one active owner.");
    }
    const user = await this.database.client.user.update({
      where: { id: target.userId },
      data: { status },
      select: { id: true, email: true, name: true, status: true },
    });
    if (status === "disabled") {
      await this.database.client.session.updateMany({
        where: { userId: target.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      eventType: "admin_user_status_changed",
      actorUserId: principal.userId,
      workspaceId: target.workspaceId,
      targetType: "user",
      targetId: target.userId,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { status },
    });
    return { user };
  }

  @Post("users/role")
  public async role(
    @Body() body: AdminBody,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const target = await this.target(
      principal,
      body.user_id,
      body.workspace_id,
    );
    const roleMap: Record<string, "ADMIN" | "MEMBER" | "VIEWER"> = {
      admin: "ADMIN",
      member: "MEMBER",
      user: "MEMBER",
      viewer: "VIEWER",
    };
    const role = body.role
      ? roleMap[body.role.trim().toLowerCase()]
      : undefined;
    if (!role) throw new ForbiddenException("Unsupported workspace role.");
    return {
      role: await this.workspaces.changeRole(
        target.workspaceId,
        target.userId,
        { role },
        principal,
        request,
      ),
    };
  }

  @Post("users/mcp-token/revoke")
  public async revokeToken(
    @Body() body: AdminBody,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const target = await this.target(
      principal,
      body.user_id,
      body.workspace_id,
    );
    const revoked = await this.database.client.serviceToken.updateMany({
      where: {
        serviceIdentity: { workspaceId: target.workspaceId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      eventType: "admin_service_tokens_revoked",
      actorUserId: principal.userId,
      workspaceId: target.workspaceId,
      targetType: "user",
      targetId: target.userId,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { count: revoked.count },
    });
    return { token: { revoked: revoked.count } };
  }

  @Get("diagnostics")
  public async diagnostics(@CurrentPrincipal() principal: HumanPrincipal) {
    const workspaceIds = await this.adminWorkspaceIds(principal);
    const [users, connections, accounts] = await Promise.all([
      this.database.client.workspaceMembership.count({
        where: { workspaceId: { in: workspaceIds } },
      }),
      this.database.client.providerConnection.count({
        where: { workspaceId: { in: workspaceIds } },
      }),
      this.database.client.providerAccount.count({
        where: { workspaceId: { in: workspaceIds }, enabled: true },
      }),
    ]);
    return {
      status: "ok",
      workspaces: workspaceIds.length,
      users,
      connections,
      enabled_accounts: accounts,
      credentials_exposed: false,
      read_only_diagnostics: true,
    };
  }

  private async adminWorkspaceIds(
    principal: HumanPrincipal,
  ): Promise<string[]> {
    const memberships = await this.database.client.workspaceMembership.findMany(
      {
        where: { userId: principal.userId, role: { in: ["OWNER", "ADMIN"] } },
        select: { workspaceId: true },
      },
    );
    if (!memberships.length)
      throw new ForbiddenException("Admin access required.");
    return memberships.map((membership) => membership.workspaceId);
  }

  private async target(
    principal: HumanPrincipal,
    userId: string | undefined,
    requestedWorkspaceId?: string,
    ownerOnly = false,
  ) {
    if (!userId) throw new ForbiddenException("user_id is required.");
    const workspaceIds = await this.adminWorkspaceIds(principal);
    const workspaceId = requestedWorkspaceId ?? workspaceIds[0];
    if (!workspaceId || !workspaceIds.includes(workspaceId)) {
      throw new ForbiddenException("Workspace access denied.");
    }
    if (ownerOnly) {
      const actor = await this.database.client.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: { workspaceId, userId: principal.userId },
        },
        select: { role: true },
      });
      if (actor?.role !== "OWNER")
        throw new ForbiddenException("Owner access required.");
    }
    const target = await this.database.client.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { workspaceId: true, userId: true, role: true },
    });
    if (!target)
      throw new ForbiddenException("Target user is outside the workspace.");
    return target;
  }
}
