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
  Res,
  UseGuards,
} from "@nestjs/common";
import type { ProviderId } from "@holymedia/contracts";
import type { FastifyReply } from "fastify";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import {
  AccountSelectionBatchDto,
  AccountSelectionDto,
  ProviderDateRangeDto,
} from "./provider.dto.js";
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
  public async callback(
    @Param("provider") provider: string,
    @Query("state") state: string,
    @Query("code") code: string,
    @Req() request: RequestWithAuth,
    @Res() reply: FastifyReply,
  ) {
    const providerId = this.provider(provider);
    const redirect = (outcome: "success" | "error") =>
      reply
        .code(302)
        .redirect(
          `/dashboard?section=connections&oauth=${outcome}&provider=${encodeURIComponent(provider)}`,
        );
    if (
      typeof state !== "string" ||
      state.length < 32 ||
      state.length > 256 ||
      typeof code !== "string" ||
      code.length < 1 ||
      code.length > 512
    )
      return redirect("error");
    try {
      await this.providers.completeOAuthCallback(
        providerId,
        { state, code },
        request,
      );
      return redirect("success");
    } catch {
      return redirect("error");
    }
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

  @Patch("workspaces/:id/connections/:connectionId/accounts")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.manage")
  public selectAccounts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Body() input: AccountSelectionBatchDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.setAccountsEnabled(
      id,
      connectionId,
      input.accountIds,
      principal,
      request,
    );
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

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/summary")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public accountSummary(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    const range =
      query.startDate && query.endDate
        ? { startDate: query.startDate, endDate: query.endDate }
        : undefined;
    return this.providers.readAccountSummary(
      id,
      connectionId,
      accountId,
      range,
    );
  }

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/campaigns")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public campaigns(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    const range =
      query.startDate && query.endDate
        ? { startDate: query.startDate, endDate: query.endDate }
        : undefined;
    return this.providers.readCampaigns(
      id,
      connectionId,
      accountId,
      range,
      query.limit,
      query.cursor,
    );
  }

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/metrics")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metrics(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    if (!query.startDate || !query.endDate)
      throw new BadRequestException("startDate and endDate are required.");
    return this.providers.readMetrics(
      id,
      connectionId,
      accountId,
      { startDate: query.startDate, endDate: query.endDate },
      query.campaignId,
    );
  }

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/health")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public health(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
  ) {
    return this.providers.readHealth(id, connectionId, accountId);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/businesses")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaBusinesses(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers.metaBusinesses(id, connectionId);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/pages")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaPages(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers.metaPages(id, connectionId);
  }

  @Get(
    "workspaces/:id/connections/:connectionId/meta/businesses/:businessId/ad-accounts",
  )
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaBusinessAdAccounts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("businessId") businessId: string,
  ) {
    return this.providers.metaBusinessAdAccounts(id, connectionId, businessId);
  }

  @Get(
    "workspaces/:id/connections/:connectionId/meta/businesses/:businessId/pages",
  )
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaBusinessPages(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("businessId") businessId: string,
  ) {
    return this.providers.metaBusinessPages(id, connectionId, businessId);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/pages/:pageId/posts")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaPagePosts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("pageId") pageId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    return this.providers.metaPagePosts(id, connectionId, pageId, query.limit);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/pages/:pageId/instagram")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaInstagram(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("pageId") pageId: string,
  ) {
    return this.providers.metaInstagram(id, connectionId, pageId);
  }

  private provider(value: string): ProviderId {
    const aliases: Record<string, ProviderId> = {
      google: "GOOGLE_ADS",
      google_ads: "GOOGLE_ADS",
      meta: "META_ADS",
      meta_ads: "META_ADS",
      yandex: "YANDEX_DIRECT",
      yandex_direct: "YANDEX_DIRECT",
      tiktok: "TIKTOK_ADS",
      tiktok_ads: "TIKTOK_ADS",
      "google-search-console": "GOOGLE_SEARCH_CONSOLE",
      google_search_console: "GOOGLE_SEARCH_CONSOLE",
    };
    const normalized = aliases[value] ?? value;
    if (!isProviderId(normalized))
      throw new BadRequestException("Unsupported provider.");
    return normalized;
  }
}
