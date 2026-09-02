/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import {
  CreateInvitationDto,
  CreateWorkspaceDto,
  UpdateMemberRoleDto,
  UpdateCompanyProfileDto,
  UpdateWorkspaceDto,
} from "../auth/auth.dto.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import { WorkspaceService } from "./workspace.service.js";
import {
  type InvitationView,
  type RoleChangeResult,
  type WorkspaceMember,
  type WorkspaceSummary,
  type WorkspaceView,
} from "./workspace.service.js";

@Controller("workspaces")
@UseGuards(AuthenticationGuard)
export class WorkspaceController {
  public constructor(
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get()
  public list(
    @CurrentPrincipal() principal: HumanPrincipal,
  ): Promise<WorkspaceSummary[]> {
    return this.workspaces.listForUser(principal);
  }

  @Post()
  public create(
    @Body() input: CreateWorkspaceDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.create(input, principal, request);
  }

  @Get(":id")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("workspace.read")
  public get(@Param("id") id: string): Promise<WorkspaceView> {
    return this.workspaces.get(id);
  }

  @Patch(":id")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("workspace.manage")
  public update(
    @Param("id") id: string,
    @Body() input: UpdateWorkspaceDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ): Promise<WorkspaceView> {
    return this.workspaces.update(id, input, principal, request);
  }

  @Patch(":id/company")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("workspace.manage")
  public updateCompany(
    @Param("id") id: string,
    @Body() input: UpdateCompanyProfileDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ): Promise<WorkspaceView> {
    return this.workspaces.updateCompanyProfile(id, input, principal, request);
  }

  @Get(":id/members")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("members.read")
  public members(@Param("id") id: string): Promise<WorkspaceMember[]> {
    return this.workspaces.members(id);
  }

  @Patch(":id/members/:userId")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("members.manage")
  public changeRole(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() input: UpdateMemberRoleDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ): Promise<RoleChangeResult> {
    return this.workspaces.changeRole(id, userId, input, principal, request);
  }

  @Delete(":id/members/:userId")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("members.manage")
  public remove(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.workspaces.removeMember(id, userId, principal, request);
  }

  @Post(":id/invitations")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("members.manage")
  public invite(
    @Param("id") id: string,
    @Body() input: CreateInvitationDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ): Promise<InvitationView> {
    return this.workspaces.createInvitation(id, input, principal, request);
  }

  @Get(":id/invitations")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("members.manage")
  public invitations(@Param("id") id: string): Promise<InvitationView[]> {
    return this.workspaces.invitations(id);
  }

  @Post(":id/invitations/:invitationId/resend")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("members.manage")
  public resendInvitation(
    @Param("id") id: string,
    @Param("invitationId") invitationId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ): Promise<InvitationView> {
    return this.workspaces.resendInvitation(
      id,
      invitationId,
      principal,
      request,
    );
  }

  @Delete(":id/invitations/:invitationId")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("members.manage")
  public revokeInvitation(
    @Param("id") id: string,
    @Param("invitationId") invitationId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.workspaces.revokeInvitation(
      id,
      invitationId,
      principal,
      request,
    );
  }
}
