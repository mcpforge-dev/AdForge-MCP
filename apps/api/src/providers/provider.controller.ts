/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ProviderId } from "@holymedia/contracts";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import { AccountSelectionDto, OAuthCallbackDto } from "./provider.dto.js";
import { ProviderService } from "./provider.service.js";
import { isProviderId } from "./provider.types.js";

@Controller()
export class ProviderController {
  public constructor(
    @Inject(ProviderService) private readonly providers: ProviderService,
  ) {}

  @Get("providers")
  public listProviders() {
    return this.providers.listProviders();
  }

  @Get("workspaces/:id/connections")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.read")
  public listConnections(@Param("id") id: string) {
    return this.providers.listConnections(id);
  }

  @Post("workspaces/:id/connections/:provider/oauth/start")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.manage")
  public startOAuth(
    @Param("id") id: string,
    @Param("provider") provider: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.startOAuth(
      id,
      this.provider(provider),
      principal,
      request,
    );
  }

  @Get("oauth/:provider/callback")
  @UseGuards(AuthenticationGuard)
  public callback(
    @Param("provider") provider: string,
    @Query() input: OAuthCallbackDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.completeOAuth(
      this.provider(provider),
      input,
      principal,
      request,
    );
  }

  @Get("workspaces/:id/connections/:connectionId")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.read")
  public getConnection(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers.getConnection(id, connectionId);
  }

  @Delete("workspaces/:id/connections/:connectionId")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.manage")
  public disconnect(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.disconnect(id, connectionId, principal, request);
  }

  @Post("workspaces/:id/connections/:connectionId/refresh")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.manage")
  public refresh(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.refresh(id, connectionId, principal, request);
  }

  @Get("workspaces/:id/connections/:connectionId/accounts")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public accounts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers
      .getConnection(id, connectionId)
      .then((connection) => connection.accounts);
  }

  @Post("workspaces/:id/connections/:connectionId/accounts/discover")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.manage")
  public discover(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.discover(id, connectionId, principal, request);
  }

  @Patch("workspaces/:id/provider-accounts/:accountId")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.manage")
  public selectAccount(
    @Param("id") id: string,
    @Param("accountId") accountId: string,
    @Body() input: AccountSelectionDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.setAccountEnabled(
      id,
      accountId,
      input.enabled,
      principal,
      request,
    );
  }

  private provider(value: string): ProviderId {
    if (!isProviderId(value))
      throw new BadRequestException("Unsupported provider.");
    return value;
  }
}
