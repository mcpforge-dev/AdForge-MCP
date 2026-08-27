/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { CreateManualMetaConnectionRequestDto } from "./manual-connection-request.dto.js";
import { ManualConnectionRequestService } from "./manual-connection-request.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

@Controller("api/connection-requests")
@UseGuards(AuthenticationGuard)
export class ManualConnectionRequestController {
  public constructor(
    @Inject(ManualConnectionRequestService)
    private readonly requests: ManualConnectionRequestService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get()
  public list(@CurrentPrincipal() principal: HumanPrincipal) {
    return this.requests.listForUser(principal);
  }

  @Post("meta")
  public async create(
    @Body() input: CreateManualMetaConnectionRequestDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const workspaces = await this.workspaces.listForUser(principal);
    const workspace = input.workspace_id
      ? workspaces.find((item) => item.id === input.workspace_id)
      : workspaces[0];
    if (!workspace) return { requests: [] };
    return this.requests.create(workspace.id, principal, input, request);
  }
}
