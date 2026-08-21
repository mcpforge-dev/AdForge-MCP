import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
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
import type { CreateServiceTokenDto } from "./service-token.dto.js";
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
}
