/* eslint-disable @typescript-eslint/consistent-type-imports */
import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AcceptInvitationDto } from "../auth/auth.dto.js";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceService } from "./workspace.service.js";

@Controller("invitations")
@UseGuards(AuthenticationGuard)
export class InvitationController {
  public constructor(
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Post("accept")
  public accept(
    @Body() input: AcceptInvitationDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.workspaces.acceptInvitation(input, principal, request);
  }
}
