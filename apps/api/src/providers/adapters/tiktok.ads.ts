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
  code?: number | string;
  message?: string;
  request_id?: string;
  data?: Record<string, unknown> | unknown[];
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
    const tokenUrl = this.required(this.config.providerTikTokTokenUri);
    const legacyTokenEndpoint = /\/oauth2\/access_token\/?$/i.test(
      new URL(tokenUrl).pathname,
    );
    const body = legacyTokenEndpoint
      ? {
          app_id: this.required(this.config.providerTikTokClientId),
          secret: this.required(this.config.providerTikTokClientSecret),
          auth_code: context.code,
        }
      : {
          client_id: this.required(this.config.providerTikTokClientId),
          client_secret: this.required(this.config.providerTikTokClientSecret),
          grant_type: "authorization_code",
          auth_code: context.code,
          redirect_uri: context.redirectUri,
        };
    const payload = await providerJson<TikTokPayload>(
      tokenUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      20_000,
    );
    assertTikTokSuccess(payload);
    const data = isRecord(payload.data) ? payload.data : {};
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
    assertTikTokSuccess(payload);
    const data = isRecord(payload.data) ? payload.data : {};
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTikTokSuccess(payload: TikTokPayload): void {
  const rootCode = Number(payload.code ?? 0);
  const data = isRecord(payload.data) ? payload.data : undefined;
  const nestedCode = Number(data?.error_code ?? 0);
  const code =
    Number.isFinite(rootCode) && rootCode !== 0 ? rootCode : nestedCode;
  if (!code) return;
  const message = String(
    payload.message ?? data?.description ?? "",
  ).toLowerCase();
  const providerCode = String(code).slice(0, 80);
  if (/permission|scope|access|forbidden/.test(message))
    throw new ProviderError(
      "insufficient_permissions",
      "TikTok authorization permissions are insufficient.",
      false,
      undefined,
      providerCode,
    );
  if (/rate|limit|too many/.test(message))
    throw new ProviderError(
      "rate_limited",
      "TikTok rate limit was reached.",
      true,
      undefined,
      providerCode,
    );
  throw new ProviderError(
    "authentication_failed",
    "TikTok authorization was rejected.",
    false,
    undefined,
    providerCode,
  );
}
