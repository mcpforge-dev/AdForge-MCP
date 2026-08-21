import {
  Controller,
  Get,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { RequestWithAuth } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { McpService } from "../mcp/mcp.service.js";
import { ProviderService } from "../providers/provider.service.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";

/** Redacted V1 diagnostics facade. It authenticates with the same scoped MCP token. */
@Controller()
export class LegacyDiagnosticsController {
  public constructor(
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProviderService) private readonly providers: ProviderService,
    @Inject(McpService) private readonly mcp: McpService,
  ) {}

  @Get("api/diagnostics")
  public diagnostics(@Req() request: RequestWithAuth) {
    return this.withPrincipal(request, async (principal) => {
      const accounts = await this.accounts(
        principal.workspaceId,
        principal.accountIds,
      );
      return {
        status: "ok",
        workspace_id: principal.workspaceId,
        auth_required: true,
        read_only: true,
        accounts: accounts.length,
        providers: this.providers.listProviders().map((provider) => ({
          id: provider.id,
          display_name: provider.displayName,
          status: provider.status,
        })),
        next_actions: accounts.length
          ? []
          : ["Connect a provider and enable an account."],
      };
    });
  }

  @Get("api/diagnostics/platforms")
  public platforms(@Req() request: RequestWithAuth) {
    return this.withPrincipal(request, async (principal) => ({
      platforms: this.providers.listProviders().map((provider) => ({
        id: provider.id,
        display_name: provider.displayName,
        status: provider.status,
        read_only: true,
      })),
      workspace_id: principal.workspaceId,
    }));
  }

  @Get("api/diagnostics/mcp")
  public mcpDiagnostics(@Req() request: RequestWithAuth) {
    return this.withPrincipal(request, async (principal) => ({
      workspace_id: principal.workspaceId,
      endpoint: "/mcp",
      transport: "streamable-http",
      auth_required: true,
      read_only: true,
      tool_count: this.mcp.tools().length,
    }));
  }

  @Get("api/diagnostics/security")
  public security(@Req() request: RequestWithAuth) {
    return this.withPrincipal(request, async () => ({
      api_auth_required: true,
      mcp_auth_required: true,
      preview_only: true,
      live_writes_enabled: false,
      tokens_returned: false,
      provider_credentials_exposed: false,
    }));
  }

  @Get("api/beta/capabilities")
  public capabilities(@Req() request: RequestWithAuth) {
    return this.withPrincipal(request, async (principal) => ({
      hosted_model: "v2_drop_in_compatibility",
      mcp_url: "/mcp",
      workspace_id: principal.workspaceId,
      tools: this.mcp.tools().map((tool) => tool.name),
      preview_only: true,
      live_writes_enabled: false,
      providers: this.providers.listProviders().map((provider) => provider.id),
    }));
  }

  private async withPrincipal<T>(
    request: RequestWithAuth,
    callback: (principal: ServiceTokenPrincipal) => Promise<T>,
  ): Promise<T> {
    const raw = request.headers.authorization;
    const authorization = Array.isArray(raw) ? raw[0] : raw;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";
    const principal = token ? await this.tokens.authenticate(token) : null;
    if (!principal) throw new UnauthorizedException("Authorization required.");
    return callback(principal);
  }

  private accounts(workspaceId: string, restrictedIds: string[]) {
    return this.database.client.providerAccount.findMany({
      where: {
        workspaceId,
        enabled: true,
        ...(restrictedIds.length ? { id: { in: restrictedIds } } : {}),
      },
      select: { id: true },
    });
  }
}
