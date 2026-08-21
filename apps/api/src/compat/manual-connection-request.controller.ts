/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import {
  CreateManualMetaConnectionRequestDto,
  ManualConnectionRequestIdDto,
  SelectManualConnectionAccountDto,
  UpdateManualConnectionRequestRequestDto,
} from "./manual-connection-request.dto.js";
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

@Controller("api/admin/connection-requests")
@UseGuards(AuthenticationGuard)
export class AdminManualConnectionRequestController {
  public constructor(
    @Inject(ManualConnectionRequestService)
    private readonly requests: ManualConnectionRequestService,
  ) {}

  @Get()
  public list(@CurrentPrincipal() principal: HumanPrincipal) {
    return this.requests.listForAdmin(principal);
  }

  @Post("status")
  public update(
    @Body() input: UpdateManualConnectionRequestRequestDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.requests.update(principal, input.request_id, input, request);
  }

  @Post("meta/authorize-url")
  public authorizeMeta(
    @Body() input: ManualConnectionRequestIdDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.requests.authorizeMeta(principal, input.request_id, request);
  }

  @Get("meta/pending")
  public pendingMeta(
    @Query("request_id") requestId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
  ) {
    if (!requestId) throw new BadRequestException("request_id is required.");
    return this.requests.pendingMeta(principal, requestId);
  }

  @Post("meta/select")
  public selectMeta(
    @Body() input: SelectManualConnectionAccountDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.requests.selectMeta(
      principal,
      input.request_id,
      input.pending_id,
      request,
    );
  }
}
