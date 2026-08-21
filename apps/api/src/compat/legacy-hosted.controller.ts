import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Redirect,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ProviderId } from "@holymedia/contracts";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { ProviderService } from "../providers/provider.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

const providerMap: Record<string, ProviderId> = {
  google: "GOOGLE_ADS",
  "search-console": "GOOGLE_SEARCH_CONSOLE",
  google_search_console: "GOOGLE_SEARCH_CONSOLE",
  meta: "META_ADS",
  tiktok: "TIKTOK_ADS",
  yandex: "YANDEX_DIRECT",
};

/** V1 hosted OAuth/dashboard routes backed by the V2 provider orchestration. */
@Controller("api/hosted")
@UseGuards(AuthenticationGuard)
export class LegacyHostedController {
  public constructor(
    @Inject(ProviderService) private readonly providers: ProviderService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get("connections")
  public async connections(@CurrentPrincipal() principal: HumanPrincipal) {
    const workspace = await this.workspace(principal);
    return { connections: await this.providers.listConnections(workspace.id) };
  }

  @Get("mcp-connection")
  public mcpConnection() {
    return { mcp_url: "/mcp", read_only: true };
  }

  @Get("oauth/diagnostics")
  public diagnostics() {
    return { providers: this.providers.listProviders() };
  }

  @Get("oauth/:provider/diagnostics")
  public providerDiagnostics(@Param("provider") provider: string) {
    return {
      provider,
      definition:
        this.providers
          .listProviders()
          .find((item) => item.id === providerMap[provider]) ?? null,
    };
  }

  @Get("oauth/:provider/authorize-url")
  public async authorizeUrl(
    @Param("provider") provider: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.start(provider, principal, request);
    return result;
  }

  @Get("oauth/:provider/start")
  @Redirect()
  public async startRedirect(
    @Param("provider") provider: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const result = await this.start(provider, principal, request);
    return { url: result.authorizationUrl, statusCode: 302 };
  }

  private async start(
    provider: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const providerId = providerMap[provider];
    if (!providerId) throw new BadRequestException("Unsupported provider.");
    const workspace = await this.workspace(principal);
    return this.providers.startOAuth(
      workspace.id,
      providerId,
      principal,
      request,
    );
  }

  private async workspace(principal: HumanPrincipal) {
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace) throw new NotFoundException("Workspace not found.");
    return workspace;
  }
}
