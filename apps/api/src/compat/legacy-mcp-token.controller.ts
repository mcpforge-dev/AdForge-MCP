import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

type LegacyTokenBody = { name?: string };

/** Compatibility facade for the V1 single-token dashboard API. */
@Controller("api/mcp-token")
@UseGuards(AuthenticationGuard)
export class LegacyMcpTokenController {
  public constructor(
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get()
  public async summary(@CurrentPrincipal() principal: HumanPrincipal) {
    const tokens = await this.tokens.list(await this.workspaceId(principal));
    return { token: tokens[0] ?? null };
  }

  @Post("create")
  @UseGuards(CsrfGuard)
  public async create(
    @Body() body: LegacyTokenBody,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.tokens.create(
      await this.workspaceId(principal),
      {
        name: body.name?.trim() || "V1 compatibility token",
        scopes: ["adforge:mcp:read"],
      },
      principal,
      request,
    );
  }

  @Post("rotate")
  @UseGuards(CsrfGuard)
  public async rotate(
    @Body() body: LegacyTokenBody,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const workspaceId = await this.workspaceId(principal);
    const current = await this.tokens.list(workspaceId);
    const next = await this.tokens.create(
      workspaceId,
      {
        name: body.name?.trim() || "V1 compatibility token",
        scopes: ["adforge:mcp:read"],
      },
      principal,
      request,
    );
    if (current[0])
      await this.tokens.revoke(workspaceId, current[0].id, principal, request);
    return next;
  }

  @Post("revoke")
  @UseGuards(CsrfGuard)
  public async revoke(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const workspaceId = await this.workspaceId(principal);
    const current = await this.tokens.list(workspaceId);
    if (current[0])
      await this.tokens.revoke(workspaceId, current[0].id, principal, request);
    return { token: { revoked: true } };
  }

  private async workspaceId(principal: HumanPrincipal): Promise<string> {
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace) throw new NotFoundException("Workspace not found.");
    if (
      workspace.accessStatus !== "ACTIVE" ||
      !["OWNER", "ADMIN"].includes(workspace.role)
    ) {
      throw new ForbiddenException("Permission denied.");
    }
    return workspace.id;
  }
}
