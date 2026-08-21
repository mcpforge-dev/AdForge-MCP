import { loadConfig, type AppConfig } from "@holymedia/config";
import type { ProviderDefinition } from "@holymedia/contracts";
import { ProviderError } from "../provider.errors.js";
import { providerJson } from "../provider-http.js";
import type {
  NormalizedProviderAccount,
  OAuthExchangeContext,
  OAuthStartContext,
  ProviderCredentialPayload,
  ProviderOAuthAdapter,
} from "../provider.types.js";

export const tiktokAdsDefinition = (
  configured: boolean,
): ProviderDefinition => ({
  id: "TIKTOK_ADS",
  displayName: "TikTok Ads",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: false,
  read: false,
  write: false,
  status: configured ? "available" : "configuration_required",
  scopes: [],
});

type TikTokPayload = {
  code?: number;
  message?: string;
  data?: Record<string, unknown>;
};

export class TikTokAdsAdapter implements ProviderOAuthAdapter {
  public readonly definition: ProviderDefinition;
  private readonly config: AppConfig;

  public constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.definition = tiktokAdsDefinition(
      Boolean(
        config.providerTikTokClientId &&
        config.providerTikTokClientSecret &&
        config.providerTikTokRedirectUri,
      ),
    );
  }

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL(this.required(this.config.providerTikTokAuthUri));
    url.searchParams.set(
      "app_id",
      this.required(this.config.providerTikTokClientId),
    );
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("state", context.state);
    if (this.config.providerTikTokScopes.trim())
      url.searchParams.set("scope", this.config.providerTikTokScopes.trim());
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    const payload = await providerJson<TikTokPayload>(
      this.required(this.config.providerTikTokTokenUri),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: this.required(this.config.providerTikTokClientId),
          secret: this.required(this.config.providerTikTokClientSecret),
          auth_code: context.code,
        }),
      },
      20_000,
    );
    const data = payload.data ?? {};
    const accessToken = String(data.access_token ?? "").trim();
    if (!accessToken)
      throw new ProviderError(
        "provider_response_invalid",
        "TikTok OAuth token exchange returned no access token.",
      );
    const expiresIn = Number(data.expires_in ?? 0);
    return {
      accessToken,
      ...(data.refresh_token
        ? { refreshToken: String(data.refresh_token) }
        : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0
        ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
      tokenType: "Bearer",
      scopes: this.config.providerTikTokScopes
        .split(/[ ,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    };
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    const payload = await providerJson<TikTokPayload>(
      this.required(this.config.providerTikTokAdvertiserUri),
      {
        method: "GET",
        headers: { "Access-Token": credentials.accessToken },
      },
      20_000,
    );
    const data = payload.data ?? {};
    const candidates =
      data.advertiser_ids ??
      data.advertiser_id_list ??
      data.list ??
      data.advertiser_info;
    const rows = Array.isArray(candidates)
      ? candidates
      : candidates
        ? [candidates]
        : [];
    const accounts: NormalizedProviderAccount[] = [];
    for (const row of rows) {
      const value: Record<string, unknown> =
        typeof row === "object" && row !== null
          ? (row as Record<string, unknown>)
          : { advertiser_id: row };
      const id = String(
        value.advertiser_id ?? value.advertiserId ?? value.id ?? "",
      ).trim();
      if (!id) continue;
      accounts.push({
        externalAccountId: id,
        displayName: String(
          value.advertiser_name ??
            value.advertiserName ??
            value.name ??
            `TikTok Advertiser ${id}`,
        ),
        status: "active",
        metadata: { source: "TikTok Marketing API" },
      });
    }
    if (accounts.length > 0) return accounts;
    const fallback = this.config.providerTikTokAdvertiserId;
    return fallback
      ? [
          {
            externalAccountId: fallback,
            displayName: `TikTok Advertiser ${fallback}`,
            status: "unknown",
            metadata: { source: "TikTok configuration fallback" },
          },
        ]
      : [];
  }

  private required(value: string | undefined): string {
    if (!value)
      throw new ProviderError(
        "provider_not_configured",
        "TikTok Ads is not configured.",
      );
    return value;
  }
}
