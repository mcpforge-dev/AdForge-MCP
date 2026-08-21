import { loadConfig, type AppConfig } from "@holymedia/config";
import type {
  ProviderAccountSummary,
  ProviderCampaign,
  ProviderDateRange,
  ProviderDefinition,
  ProviderHealthView,
  ProviderMetricSummary,
} from "@holymedia/contracts";
import { ProviderError } from "../provider.errors.js";
import {
  assertExternalId,
  encodeJson,
  providerJson,
} from "../provider-http.js";
import {
  numberValue,
  provenance,
  sumMetrics,
  validateDateRange,
} from "../provider-normalization.js";
import type {
  MetaBusiness,
  MetaPage,
  NormalizedProviderAccount,
  OAuthExchangeContext,
  OAuthStartContext,
  ProviderCredentialPayload,
  ProviderMutationAdapter,
  ProviderOAuthAdapter,
  ProviderCampaignMutation,
  ProviderReadAdapter,
  ProviderReadContext,
} from "../provider.types.js";

const CORE_SCOPES = [
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
];

export const metaAdsDefinition = (
  config: AppConfig,
  configured: boolean,
): ProviderDefinition => ({
  id: "META_ADS",
  displayName: "Meta Ads",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: true,
  read: configured,
  write: configured && config.providerMetaAdsManagementOauthEnabled,
  status: configured ? "available" : "configuration_required",
  scopes: [
    ...CORE_SCOPES,
    ...(config.providerMetaAdsManagementOauthEnabled ? ["ads_management"] : []),
  ],
});

type MetaResponse = Record<string, unknown>;

export class MetaAdsAdapter
  implements ProviderOAuthAdapter, ProviderReadAdapter, ProviderMutationAdapter
{
  public readonly definition: ProviderDefinition;
  private readonly config: AppConfig;

  public constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.definition = metaAdsDefinition(
      config,
      Boolean(
        config.providerMetaClientId &&
        config.providerMetaClientSecret &&
        config.providerMetaRedirectUri,
      ),
    );
  }

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL(
      `https://www.facebook.com/${this.config.providerMetaApiVersion}/dialog/oauth`,
    );
    url.searchParams.set(
      "client_id",
      this.required(this.config.providerMetaClientId),
    );
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.definition.scopes.join(","));
    url.searchParams.set("state", context.state);
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    const url = this.graphUrl("oauth/access_token", {
      client_id: this.required(this.config.providerMetaClientId),
      client_secret: this.required(this.config.providerMetaClientSecret),
      redirect_uri: context.redirectUri,
      code: context.code,
    });
    const response = await this.get(url);
    const token = String(response.access_token || "");
    if (!token)
      throw new ProviderError(
        "authentication_failed",
        "Meta OAuth did not return an access token.",
      );
    const identity = await this.get(
      this.graphUrl("me", { fields: "id,name", access_token: token }),
    );
    const permissions = await this.permissionPayload(token);
    const expiresIn = numberValue(response.expires_in);
    return {
      accessToken: token,
      ...(expiresIn
        ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
      tokenType: String(response.token_type || "Bearer"),
      scopes: permissions.granted,
      externalSubjectId: String(identity.id || ""),
      displayName: String(identity.name || "Meta connection"),
      providerMetadata: {
        requestedScopes: this.definition.scopes.join(","),
        declinedScopes: permissions.declined.join(","),
      },
    };
  }

  public async refreshCredentials(
    credentials: ProviderCredentialPayload,
  ): Promise<ProviderCredentialPayload> {
    const url = this.graphUrl("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.required(this.config.providerMetaClientId),
      client_secret: this.required(this.config.providerMetaClientSecret),
      fb_exchange_token: credentials.accessToken,
    });
    const response = await this.get(url);
    const token = String(response.access_token || "");
    if (!token)
      throw new ProviderError(
        "refresh_failed",
        "Meta authorization refresh failed.",
      );
    const expiresIn = numberValue(response.expires_in);
    return {
      ...credentials,
      accessToken: token,
      ...(expiresIn
        ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
    };
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    const response = await this.listEdge(
      "me/adaccounts",
      { fields: "id,name,currency,timezone_name,account_status" },
      credentials.accessToken,
      500,
    );
    return response
      .map((row) => ({
        externalAccountId: String(row.id || ""),
        displayName: String(row.name || `Meta Ads ${row.id || ""}`),
        ...(optionalString(row.currency)
          ? { currency: optionalString(row.currency)! }
          : {}),
        ...(optionalString(row.timezoneName ?? row.timezone_name)
          ? { timezone: optionalString(row.timezoneName ?? row.timezone_name)! }
          : {}),
        status: metaAccountStatus(row.accountStatus ?? row.account_status),
        metadata: {
          source: "Meta Graph API",
          accountId: String(row.accountId || row.id || ""),
        },
      }))
      .filter((row) => row.externalAccountId.length > 0);
  }

  public async getAccountSummary(
    context: ProviderReadContext,
    range?: ProviderDateRange,
  ): Promise<ProviderAccountSummary> {
    const accountId = metaAccountPath(context.accountId);
    const account = await this.get(
      this.graphUrl(accountId, {
        fields: "id,name,currency,timezone_name,account_status",
        access_token: context.credentials.accessToken,
      }),
    );
    const currency = optionalString(account.currency);
    const base = {
      externalAccountId: String(account.id || context.accountId),
      displayName: String(account.name || context.accountId),
      currency,
      timezone: optionalString(account.timezoneName ?? account.timezone_name),
      status: metaAccountStatus(
        account.accountStatus ?? account.account_status,
      ),
    };
    const metrics = range ? await this.getMetrics(context, range) : undefined;
    return {
      id: "",
      provider: "META_ADS",
      ...base,
      enabled: true,
      discoveredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      ...(metrics ? { metrics } : {}),
      provenance: provenance("META_ADS", "Meta Graph API ad account"),
    };
  }

  public async listCampaigns(
    context: ProviderReadContext,
    range?: ProviderDateRange,
    limit = 100,
    cursor?: string,
  ) {
    const accountId = metaAccountPath(context.accountId);
    const rows = await this.listEdge(
      `${accountId}/campaigns`,
      {
        fields:
          "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
        ...(range ? { date_preset: "lifetime" } : {}),
      },
      context.credentials.accessToken,
      Math.min(Math.max(limit, 1), 500),
    );
    const items = rows.map(
      (row) =>
        ({
          id: String(row.id || ""),
          name: String(row.name || ""),
          status: optionalString(
            row.effectiveStatus || row.effective_status || row.status,
          ),
          objective: optionalString(row.objective),
          budget: metaBudget(
            row,
            context.currency ?? optionalString(row.currency),
          ),
          metadata: {
            source: "Meta Graph API",
            configuredStatus: optionalString(row.configuredStatus),
          },
          provenance: provenance("META_ADS", "Meta Graph API campaign"),
        }) satisfies ProviderCampaign,
    );
    const offset = cursor ? Number(cursor) || 0 : 0;
    const page = items.slice(
      offset,
      offset + Math.min(Math.max(limit, 1), 500),
    );
    return {
      items: page,
      ...(offset + page.length < items.length
        ? { nextCursor: String(offset + page.length) }
        : {}),
    };
  }

  public async getMetrics(
    context: ProviderReadContext,
    range: ProviderDateRange,
    campaignId?: string,
  ): Promise<ProviderMetricSummary> {
    const normalized = validateDateRange(range);
    const accountId = metaAccountPath(context.accountId);
    const params: Record<string, string> = {
      fields: "spend,impressions,clicks,ctr,cpc,cpm,actions",
      time_range: encodeJson({
        since: normalized.startDate,
        until: normalized.endDate,
      }),
      access_token: context.credentials.accessToken,
    };
    if (campaignId) {
      params.level = "campaign";
      params.filtering = encodeJson([
        {
          field: "campaign.id",
          operator: "EQUAL",
          value: assertExternalId(campaignId, "campaign id"),
        },
      ]);
    }
    const rows = await this.listEdge(
      `${accountId}/insights`,
      params,
      context.credentials.accessToken,
      500,
    );
    const normalizedRows = rows.map((row) => ({
      raw: { ...row, conversions: metaConversions(row.actions) },
      spend: row.spend,
    }));
    return sumMetrics(normalizedRows, context.currency ?? null);
  }

  public async health(
    context: ProviderReadContext,
  ): Promise<ProviderHealthView> {
    const missingScopes = this.definition.scopes.filter(
      (scope) => !context.credentials.scopes.includes(scope),
    );
    try {
      await this.get(
        this.graphUrl(metaAccountPath(context.accountId), {
          fields: "id",
          access_token: context.credentials.accessToken,
        }),
      );
      return {
        credentialsValid: true,
        providerReachable: true,
        scopesSufficient: missingScopes.length === 0,
        accountReachable: true,
        selectedAccountValid: true,
        status: missingScopes.length ? "degraded" : "healthy",
        missingScopes,
        provenance: provenance("META_ADS", "Meta Graph API health"),
      };
    } catch (error) {
      const status =
        error instanceof ProviderError &&
        [
          "authentication_failed",
          "connection_revoked",
          "refresh_failed",
        ].includes(error.code)
          ? "reauth_required"
          : "degraded";
      return {
        credentialsValid: status !== "reauth_required",
        providerReachable: true,
        scopesSufficient: missingScopes.length === 0,
        accountReachable: false,
        selectedAccountValid: false,
        status,
        missingScopes,
        provenance: provenance("META_ADS", "Meta Graph API health", "partial"),
      };
    }
  }

  public async mutateCampaign(
    context: ProviderReadContext,
    mutation: ProviderCampaignMutation,
  ): Promise<{ externalObjectId: string }> {
    if (!context.credentials.scopes.includes("ads_management"))
      throw new ProviderError(
        "insufficient_permissions",
        "Meta ads_management permission is required.",
      );
    const objectId = assertExternalId(mutation.objectId, "campaign id");
    const body = new URLSearchParams({
      access_token: context.credentials.accessToken,
    });
    if (mutation.operation === "change_name") {
      const name = String(mutation.payload.new_name ?? "").trim();
      if (!name || name.length > 255)
        throw new ProviderError(
          "provider_response_invalid",
          "Campaign name is invalid.",
        );
      body.set("name", name);
    } else {
      body.set("status", mutation.operation === "pause" ? "PAUSED" : "ACTIVE");
    }
    await providerJson<MetaResponse>(
      this.graphUrl(objectId, {}),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      this.config.providerHttpTimeoutMs,
    );
    return { externalObjectId: objectId };
  }

  public async listBusinesses(
    credentials: ProviderCredentialPayload,
  ): Promise<MetaBusiness[]> {
    const rows = await this.listEdge(
      "me/businesses",
      { fields: "id,name,verification_status" },
      credentials.accessToken,
      500,
    );
    return rows
      .map((row) => ({
        id: String(row.id || ""),
        name: optionalString(row.name),
        verificationStatus: optionalString(row.verificationStatus),
        provenance: provenance("META_ADS", "Meta Graph API /me/businesses"),
      }))
      .filter((row) => row.id);
  }

  public async listPages(
    credentials: ProviderCredentialPayload,
  ): Promise<MetaPage[]> {
    const rows = await this.listEdge(
      "me/accounts",
      { fields: "id,name,category,instagram_business_account{id,username}" },
      credentials.accessToken,
      500,
    );
    return rows
      .map((row) => ({
        id: String(row.id || ""),
        name: optionalString(row.name),
        category: optionalString(row.category),
        linkedInstagram: instagramValue(
          row.instagramBusinessAccount || row.instagram_business_account,
        ),
        provenance: provenance("META_ADS", "Meta Graph API /me/accounts"),
      }))
      .filter((row) => row.id);
  }

  public async listBusinessAdAccounts(
    credentials: ProviderCredentialPayload,
    businessId: string,
  ): Promise<NormalizedProviderAccount[]> {
    const id = assertExternalId(businessId, "business id");
    const rows = (
      await Promise.all(
        ["owned_ad_accounts", "client_ad_accounts"].map((edge) =>
          this.listEdge(
            `${id}/${edge}`,
            {
              fields:
                "id,account_id,name,currency,timezone_name,account_status",
            },
            credentials.accessToken,
            500,
          ),
        ),
      )
    ).flat();
    return [...new Map(rows.map((row) => [String(row.id || ""), row])).values()]
      .filter((row) => row.id)
      .map((row) => ({
        externalAccountId: String(row.id),
        displayName: String(row.name || row.id),
        ...(optionalString(row.currency)
          ? { currency: optionalString(row.currency)! }
          : {}),
        ...(optionalString(row.timezoneName ?? row.timezone_name)
          ? { timezone: optionalString(row.timezoneName ?? row.timezone_name)! }
          : {}),
        status: metaAccountStatus(row.accountStatus ?? row.account_status),
        metadata: { source: "Meta Graph API Business asset" },
      }));
  }

  public async listBusinessPages(
    credentials: ProviderCredentialPayload,
    businessId: string,
  ): Promise<MetaPage[]> {
    const id = assertExternalId(businessId, "business id");
    const rows = (
      await Promise.all(
        ["owned_pages", "client_pages"].map((edge) =>
          this.listEdge(
            `${id}/${edge}`,
            {
              fields:
                "id,name,category,instagram_business_account{id,username}",
            },
            credentials.accessToken,
            500,
          ),
        ),
      )
    ).flat();
    return [...new Map(rows.map((row) => [String(row.id || ""), row])).values()]
      .filter((row) => row.id)
      .map((row) => ({
        id: String(row.id),
        name: optionalString(row.name),
        category: optionalString(row.category),
        linkedInstagram: instagramValue(
          row.instagramBusinessAccount || row.instagram_business_account,
        ),
        provenance: provenance(
          "META_ADS",
          "Meta Graph API Business Page asset",
        ),
      }));
  }

  public async listPagePosts(
    credentials: ProviderCredentialPayload,
    pageId: string,
    limit = 25,
  ) {
    const token = await this.pageAccessToken(credentials.accessToken, pageId);
    const rows = await this.listEdge(
      `${assertExternalId(pageId, "page id")}/published_posts`,
      {
        fields:
          "id,message,story,created_time,permalink_url,full_picture,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)",
      },
      token,
      limit,
    );
    return {
      items: rows,
      provenance: provenance(
        "META_ADS",
        "Meta Graph API Page published_posts",
        rows.length ? "live" : "empty",
      ),
    };
  }

  public async getPageInstagramAccount(
    credentials: ProviderCredentialPayload,
    pageId: string,
  ): Promise<MetaPage> {
    const token = await this.pageAccessToken(credentials.accessToken, pageId);
    const row = await this.get(
      this.graphUrl(assertExternalId(pageId, "page id"), {
        fields: "id,name,instagram_business_account{id,username}",
        access_token: token,
      }),
    );
    const linkedInstagram = instagramValue(
      row.instagramBusinessAccount || row.instagram_business_account,
    );
    return {
      id: String(row.id || pageId),
      name: optionalString(row.name),
      linkedInstagram,
      provenance: provenance(
        "META_ADS",
        "Meta Graph API Page instagram_business_account",
        linkedInstagram ? "live" : "empty",
      ),
    };
  }

  private async pageAccessToken(
    userToken: string,
    pageId: string,
  ): Promise<string> {
    const rows = await this.listEdge(
      "me/accounts",
      { fields: "id,access_token" },
      userToken,
      500,
    );
    const page = rows.find((row) => String(row.id || "") === pageId);
    const token = String(page?.accessToken || page?.access_token || "");
    if (!token)
      throw new ProviderError(
        "insufficient_permissions",
        "Meta did not provide a Page access token.",
      );
    return token;
  }

  private async permissionPayload(
    token: string,
  ): Promise<{ granted: string[]; declined: string[] }> {
    const rows = await this.listEdge(
      "me/permissions",
      { fields: "permission,status" },
      token,
      200,
    );
    const granted = rows
      .filter((row) => row.status === "granted")
      .map((row) => String(row.permission || ""))
      .filter(Boolean);
    const declined = rows
      .filter((row) => row.status !== "granted")
      .map((row) => String(row.permission || ""))
      .filter(Boolean);
    return { granted: [...new Set(granted)], declined: [...new Set(declined)] };
  }

  private async listEdge(
    path: string,
    params: Record<string, string>,
    token: string,
    limit: number,
  ): Promise<MetaResponse[]> {
    const rows: MetaResponse[] = [];
    let url = this.graphUrl(path, {
      ...params,
      access_token: token,
      limit: String(Math.min(Math.max(limit, 1), 100)),
    });
    for (let page = 0; page < 10 && rows.length < limit; page += 1) {
      const payload = await this.get(url);
      const data = Array.isArray(payload.data) ? payload.data : [];
      rows.push(
        ...data.filter((row): row is MetaResponse =>
          Boolean(row && typeof row === "object"),
        ),
      );
      const next =
        payload.paging && typeof payload.paging === "object"
          ? String((payload.paging as Record<string, unknown>).next || "")
          : "";
      if (!next || !next.startsWith("https://graph.facebook.com/")) break;
      url = next;
    }
    return rows.slice(0, limit);
  }

  private async get(url: string): Promise<MetaResponse> {
    const parsed = new URL(url);
    const accessToken = parsed.searchParams.get("access_token");
    parsed.searchParams.delete("access_token");
    return providerJson<MetaResponse>(
      parsed.toString(),
      {
        method: "GET",
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      },
      this.config.providerHttpTimeoutMs,
    );
  }

  private graphUrl(path: string, params: Record<string, string>): string {
    const normalized = path.replace(/^\/+/, "");
    return `https://graph.facebook.com/${this.config.providerMetaApiVersion}/${normalized}?${new URLSearchParams(params).toString()}`;
  }

  private required(value: string | undefined): string {
    if (!value)
      throw new ProviderError(
        "provider_not_configured",
        "Meta provider is not configured.",
      );
    return value;
  }
}

function metaAccountPath(value: string): string {
  const normalized = value.replace(/^act_/, "");
  if (!/^\d{1,30}$/.test(normalized))
    throw new ProviderError(
      "invalid_account",
      "Meta ad account ID is invalid.",
    );
  return `act_${normalized}`;
}
function optionalString(value: unknown): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}
function metaAccountStatus(value: unknown): string {
  const status = String(value ?? "unknown");
  return status === "1"
    ? "active"
    : status === "2"
      ? "disabled"
      : status.toLowerCase();
}
function metaBudget(row: MetaResponse, currency: string | null) {
  const daily = numberValue(row.dailyBudget ?? row.daily_budget);
  const lifetime = numberValue(row.lifetimeBudget ?? row.lifetime_budget);
  const amount = daily ?? lifetime;
  return amount === null
    ? null
    : { amount: (amount / 100).toFixed(2), currency };
}
function instagramValue(
  value: unknown,
): { id: string; username: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as MetaResponse;
  const id = String(row.id || "");
  return id ? { id, username: optionalString(row.username) } : null;
}
function metaConversions(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set([
    "lead",
    "offsite_conversion",
    "purchase",
    "complete_registration",
  ]);
  let total = 0;
  let found = false;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as MetaResponse;
    if (!allowed.has(String(row.actionType || row.action_type || ""))) continue;
    const count = numberValue(row.value);
    if (count !== null) {
      total += count;
      found = true;
    }
  }
  return found ? total : null;
}
