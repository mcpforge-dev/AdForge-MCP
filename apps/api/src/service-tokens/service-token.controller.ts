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
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
// Nest needs these DTO classes at runtime for whitelist validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreateServiceTokenDto,
  RotateServiceTokenDto,
  UpdateServiceTokenDto,
  UpdateServiceTokenScopesDto,
} from "./service-token.dto.js";
import { ServiceTokenService } from "./service-token.service.js";

@Controller("workspaces")
@UseGuards(AuthenticationGuard)
export class ServiceTokenController {
  public constructor(
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
  ) {}

  @Get(":id/service-tokens")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("mcp.tokens.manage")
  public list(@Param("id") id: string) {
    return this.tokens.list(id);
  }

  @Post(":id/service-tokens")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("mcp.tokens.manage")
  public create(
    @Param("id") id: string,
    @Body() input: CreateServiceTokenDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.tokens.create(id, input, principal, request);
  }

  @Delete(":id/service-tokens/:tokenId")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("mcp.tokens.manage")
  public revoke(
    @Param("id") id: string,
    @Param("tokenId") tokenId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.tokens.revoke(id, tokenId, principal, request);
  }

  @Patch(":id/service-tokens/:tokenId")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("mcp.tokens.manage")
  public updateName(
    @Param("id") id: string,
    @Param("tokenId") tokenId: string,
    @Body() input: UpdateServiceTokenDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.tokens.updateName(id, tokenId, input, principal, request);
  }

  @Post(":id/service-tokens/:tokenId/rotate")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("mcp.tokens.manage")
  public rotate(
    @Param("id") id: string,
    @Param("tokenId") tokenId: string,
    @Body() input: RotateServiceTokenDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.tokens.rotate(id, tokenId, input, principal, request);
  }

  @Patch(":id/service-tokens/:tokenId/scopes")
  @UseGuards(WorkspaceAuthorizationGuard)
  @RequirePermissions("mcp.tokens.manage")
  public updateScopes(
    @Param("id") id: string,
    @Param("tokenId") tokenId: string,
    @Body() input: UpdateServiceTokenScopesDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.tokens.updateScopes(id, tokenId, input, principal, request);
  }
}
