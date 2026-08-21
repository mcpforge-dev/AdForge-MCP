import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { ProviderId } from "@holymedia/contracts";
import { ProviderService } from "../providers/provider.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";

const providerAliases: Record<string, ProviderId> = {
  google_ads: "GOOGLE_ADS",
  meta_ads: "META_ADS",
  yandex_direct: "YANDEX_DIRECT",
  tiktok_ads: "TIKTOK_ADS",
};

export const V1_COMPATIBLE_MCP_TOOLS = [
  "list_providers",
  "get_provider_capabilities",
  "list_supported_objects",
  "list_supported_metrics",
  "list_connected_platforms",
  "list_accounts",
  "list_ad_accounts",
  "get_account_status",
  "get_account_summary",
  "list_campaigns",
  "get_campaign",
  "get_campaign_statuses",
  "get_basic_metrics",
  "get_performance_report",
  "run_diagnostics",
  "run_connection_diagnostics",
  "get_meta_oauth_permissions",
  "list_meta_businesses",
  "get_meta_business",
  "list_business_ad_accounts",
  "list_business_pages",
  "list_meta_pages",
  "get_meta_page",
  "list_page_posts",
  "get_page_post",
  "get_page_post_engagement",
  "get_page_instagram_account",
] as const;

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function providerId(value: unknown): ProviderId {
  const normalized = text(value).toLowerCase();
  const result = providerAliases[normalized];
  if (!result) throw new ForbiddenException("Unsupported provider.");
  return result;
}

function range(args: JsonObject) {
  const startDate = text(args.start_date || args.startDate);
  const endDate = text(args.end_date || args.endDate);
  return startDate && endDate ? { startDate, endDate } : undefined;
}

@Injectable()
export class McpService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProviderService) private readonly providers: ProviderService,
  ) {}

  public tools() {
    return V1_COMPATIBLE_MCP_TOOLS.map((name) => ({
      name,
      description: `HolyMedia MCP compatibility tool: ${name}`,
      inputSchema: { type: "object", additionalProperties: true },
    }));
  }

  public async call(
    principal: ServiceTokenPrincipal,
    name: string,
    rawArguments: unknown,
  ): Promise<unknown> {
    if (
      !principal.scopes.includes("adforge:mcp:read") &&
      !principal.scopes.includes("adforge:mcp")
    ) {
      throw new ForbiddenException("Service token does not have read access.");
    }
    const args = objectValue(rawArguments);
    switch (name) {
      case "list_providers":
        return this.providers.listProviders();
      case "get_provider_capabilities":
        return (
          this.providers
            .listProviders()
            .find((item) => item.id === providerId(args.provider)) ?? null
        );
      case "list_supported_objects":
        return this.supported(providerId(args.provider), "objects");
      case "list_supported_metrics":
        return this.supported(providerId(args.provider), "metrics");
      case "list_connected_platforms":
        return this.listAccounts(principal, undefined);
      case "list_accounts":
        return this.listAccounts(principal, args.provider);
      case "list_ad_accounts":
        return this.listAccounts(principal, args.provider);
      case "get_account_status": {
        const account = await this.account(principal, args);
        return {
          provider: account.provider,
          account_id: account.externalAccountId,
          name: account.displayName,
          status: account.status,
          enabled: account.enabled,
        };
      }
      case "get_account_summary": {
        const account = await this.account(principal, args);
        return this.providers.readAccountSummary(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
        );
      }
      case "list_campaigns": {
        const account = await this.account(principal, args);
        return this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          typeof args.limit === "number" ? args.limit : undefined,
          text(args.cursor) || undefined,
        );
      }
      case "get_campaign": {
        const account = await this.account(principal, args);
        const campaignId = text(args.campaign_id || args.campaignId);
        if (!campaignId)
          throw new ForbiddenException("campaign_id is required.");
        const result = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          500,
        );
        return result.items.find((item) => item.id === campaignId) ?? null;
      }
      case "get_campaign_statuses": {
        const account = await this.account(principal, args);
        const result = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          500,
        );
        return result.items.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
        }));
      }
      case "get_basic_metrics": {
        const account = await this.account(principal, args);
        const dates = range(args);
        if (!dates)
          throw new ForbiddenException("start_date and end_date are required.");
        return this.providers.readMetrics(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
          text(args.campaign_id || args.campaignId) || undefined,
        );
      }
      case "get_performance_report": {
        const account = await this.account(principal, args);
        const dates = range(args);
        if (!dates)
          throw new ForbiddenException("start_date and end_date are required.");
        return {
          provider: account.provider,
          account_id: account.externalAccountId,
          period: dates,
          metrics: await this.providers.readMetrics(
            principal.workspaceId,
            account.connectionId,
            account.id,
            dates,
          ),
          campaigns: await this.providers.readCampaigns(
            principal.workspaceId,
            account.connectionId,
            account.id,
            dates,
            100,
          ),
        };
      }
      case "run_diagnostics":
        return {
          status: "ok",
          workspace_id: principal.workspaceId,
          read_only: true,
        };
      case "run_connection_diagnostics": {
        const account = await this.account(principal, args);
        return this.providers.readHealth(
          principal.workspaceId,
          account.connectionId,
          account.id,
        );
      }
      case "get_meta_oauth_permissions": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        const connection = await this.providers.getConnection(
          principal.workspaceId,
          account.connectionId,
        );
        return {
          requested: connection.requestedScopes,
          granted: connection.grantedScopes,
          missing: connection.missingScopes,
          status: connection.status,
        };
      }
      case "list_meta_businesses": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        return this.providers.metaBusinesses(
          principal.workspaceId,
          account.connectionId,
        );
      }
      case "get_meta_business": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        const businesses = await this.providers.metaBusinesses(
          principal.workspaceId,
          account.connectionId,
        );
        const businessId = text(args.business_id || args.businessId);
        return (
          businesses.find((business) => business.id === businessId) ?? null
        );
      }
      case "list_business_ad_accounts": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        return this.providers.metaBusinessAdAccounts(
          principal.workspaceId,
          account.connectionId,
          text(args.business_id || args.businessId),
        );
      }
      case "list_business_pages": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        return this.providers.metaBusinessPages(
          principal.workspaceId,
          account.connectionId,
          text(args.business_id || args.businessId),
        );
      }
      case "list_meta_pages": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        return this.providers.metaPages(
          principal.workspaceId,
          account.connectionId,
        );
      }
      case "get_meta_page": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        const pages = await this.providers.metaPages(
          principal.workspaceId,
          account.connectionId,
        );
        const pageId = text(args.page_id || args.pageId);
        return pages.find((page) => page.id === pageId) ?? null;
      }
      case "list_page_posts": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        return this.providers.metaPagePosts(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
          typeof args.limit === "number" ? args.limit : undefined,
        );
      }
      case "get_page_post": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        const posts = await this.providers.metaPagePosts(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
          100,
        );
        const postId = text(args.post_id || args.postId);
        return (
          posts.items.find((post) => String(post.id ?? "") === postId) ?? null
        );
      }
      case "get_page_post_engagement": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        const posts = await this.providers.metaPagePosts(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
          100,
        );
        const postId = text(args.post_id || args.postId);
        const post = posts.items.find(
          (item) => String(item.id ?? "") === postId,
        );
        if (!post) return null;
        return {
          id: postId,
          shares: post.shares ?? null,
          reactions: post.reactions ?? null,
          comments: post.comments ?? null,
          provenance: posts.provenance,
        };
      }
      case "get_page_instagram_account": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        return this.providers.metaInstagram(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
        );
      }
      default:
        throw new ForbiddenException(
          "Tool is not available in this V2 compatibility build.",
        );
    }
  }

  private async listAccounts(
    principal: ServiceTokenPrincipal,
    rawProvider: unknown,
  ) {
    const provider = rawProvider ? providerId(rawProvider) : undefined;
    const accounts = await this.database.client.providerAccount.findMany({
      where: {
        workspaceId: principal.workspaceId,
        enabled: true,
        ...(provider ? { provider } : {}),
        ...(principal.accountIds.length
          ? { id: { in: principal.accountIds } }
          : {}),
        connection: { status: "CONNECTED" },
      },
      orderBy: { displayName: "asc" },
    });
    return accounts.map((account) => ({
      provider: account.provider,
      account_id: account.externalAccountId,
      name: account.displayName,
      currency: account.currency,
      timezone: account.timezone,
      status: account.status,
      source: "v2_database_provider_account",
    }));
  }

  private supported(provider: ProviderId, kind: "objects" | "metrics") {
    const definition = this.providers
      .listProviders()
      .find((item) => item.id === provider);
    if (!definition) return { provider, items: [] };
    const items =
      kind === "objects"
        ? ["account", "campaign", ...(definition.read ? ["metrics"] : [])]
        : definition.read
          ? [
              "spend",
              "impressions",
              "clicks",
              "ctr",
              "cpc",
              "cpm",
              "conversions",
              "cost_per_conversion",
            ]
          : [];
    return { provider, items };
  }

  private async account(principal: ServiceTokenPrincipal, args: JsonObject) {
    const provider = providerId(args.provider);
    const requested = text(args.account_id || args.accountId);
    if (!requested) throw new ForbiddenException("account_id is required.");
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        provider,
        enabled: true,
        connection: { status: "CONNECTED" },
        OR: [{ id: requested }, { externalAccountId: requested }],
      },
    });
    if (
      !account ||
      (principal.accountIds.length &&
        !principal.accountIds.includes(account.id))
    ) {
      throw new ForbiddenException(
        "Account is not available to this service token.",
      );
    }
    return account;
  }
}
