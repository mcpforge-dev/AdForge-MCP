import { loadConfig, type AppConfig } from "@holymedia/config";
import type { ProviderDefinition } from "@holymedia/contracts";
import { ProviderError } from "../provider.errors.js";
import { providerJson } from "../provider-http.js";
import type {
  NormalizedProviderAccount,
  OAuthExchangeContext,
  OAuthStartContext,
  ProviderCredentialPayload,
  SearchConsoleQueryRow,
  SearchConsoleReadAdapter,
} from "../provider.types.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export const googleSearchConsoleDefinition = (
  configured: boolean,
  scopes: string,
): ProviderDefinition => ({
  id: "GOOGLE_SEARCH_CONSOLE",
  displayName: "Google Search Console",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: true,
  read: true,
  write: false,
  status: configured ? "available" : "configuration_required",
  scopes: splitScopes(scopes),
});

type SitesPayload = {
  siteEntry?: Array<{
    siteUrl?: string;
    permissionLevel?: string;
  }>;
};

type SearchAnalyticsPayload = {
  rows?: SearchConsoleQueryRow[];
};

export class GoogleSearchConsoleAdapter implements SearchConsoleReadAdapter {
  public readonly definition: ProviderDefinition;
  private readonly config: AppConfig;

  public constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.definition = googleSearchConsoleDefinition(
      Boolean(
        config.providerGoogleSearchConsoleClientId &&
        config.providerGoogleSearchConsoleClientSecret &&
        config.providerGoogleSearchConsoleRedirectUri,
      ),
      config.providerGoogleSearchConsoleScopes,
    );
  }

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set(
      "client_id",
      this.required(this.config.providerGoogleSearchConsoleClientId),
    );
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      this.config.providerGoogleSearchConsoleScopes,
    );
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", context.state);
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    const body = new URLSearchParams({
      client_id: this.required(this.config.providerGoogleSearchConsoleClientId),
      client_secret: this.required(
        this.config.providerGoogleSearchConsoleClientSecret,
      ),
      code: context.code,
      redirect_uri: context.redirectUri,
      grant_type: "authorization_code",
    });
    const payload = await providerJson<Record<string, unknown>>(
      GOOGLE_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      this.config.providerHttpTimeoutMs,
    );
    return this.credentialsFromToken(payload);
  }

  public async refreshCredentials(
    credentials: ProviderCredentialPayload,
  ): Promise<ProviderCredentialPayload> {
    if (!credentials.refreshToken)
      throw new ProviderError(
        "refresh_failed",
        "Google Search Console refresh token is unavailable.",
      );
    const body = new URLSearchParams({
      client_id: this.required(this.config.providerGoogleSearchConsoleClientId),
      client_secret: this.required(
        this.config.providerGoogleSearchConsoleClientSecret,
      ),
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    });
    try {
      const payload = await providerJson<Record<string, unknown>>(
        GOOGLE_TOKEN_URL,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        },
        this.config.providerHttpTimeoutMs,
      );
      return {
        ...credentials,
        ...this.credentialsFromToken(payload),
        refreshToken: credentials.refreshToken,
      };
    } catch {
      throw new ProviderError(
        "refresh_failed",
        "Google Search Console authorization refresh failed.",
      );
    }
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    return this.listProperties(credentials);
  }

  public async listProperties(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    const payload = await this.getJson<SitesPayload>(
      GOOGLE_SITES_URL,
      credentials,
    );
    return (payload.siteEntry ?? []).flatMap((site) => {
      const property = String(site.siteUrl ?? "").trim();
      if (!property) return [];
      return [
        {
          externalAccountId: property,
          displayName: property,
          status: "connected",
          metadata: {
            permissionLevel: String(site.permissionLevel ?? "").trim() || null,
            propertyType: property.startsWith("sc-domain:")
              ? "domain"
              : "url_prefix",
          },
        },
      ];
    });
  }

  public async querySearchAnalytics(
    credentials: ProviderCredentialPayload,
    property: string,
    startDate: string,
    endDate: string,
    dimensions: string[],
    rowLimit: number,
  ): Promise<SearchConsoleQueryRow[]> {
    const site = this.validProperty(property);
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
    const payload = await this.postJson<SearchAnalyticsPayload>(
      url,
      credentials,
      {
        startDate,
        endDate,
        dimensions,
        rowLimit: Math.max(1, Math.min(rowLimit, 25000)),
        type: "web",
      },
    );
    return Array.isArray(payload.rows) ? payload.rows : [];
  }

  public async listSitemaps(
    credentials: ProviderCredentialPayload,
    property: string,
  ): Promise<Record<string, unknown>[]> {
    const site = this.validProperty(property);
    const url = `${GOOGLE_SITES_URL}/${encodeURIComponent(site)}/sitemaps`;
    const payload = await this.getJson<{ sitemap?: Record<string, unknown>[] }>(
      url,
      credentials,
    );
    return Array.isArray(payload.sitemap) ? payload.sitemap : [];
  }

  private credentialsFromToken(
    payload: Record<string, unknown>,
  ): ProviderCredentialPayload {
    const accessToken = String(payload.access_token ?? "").trim();
    if (!accessToken)
      throw new ProviderError(
        "provider_response_invalid",
        "Google Search Console token exchange returned no access token.",
      );
    const expiresIn = Number(payload.expires_in ?? 0);
    return {
      accessToken,
      ...(payload.refresh_token
        ? { refreshToken: String(payload.refresh_token) }
        : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0
        ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
      tokenType: "Bearer",
      scopes: splitScopes(this.config.providerGoogleSearchConsoleScopes),
      ...(payload.id_token
        ? { providerMetadata: { tokenResponse: "id_token_present" } }
        : {}),
    };
  }

  private async getJson<T>(
    url: string,
    credentials: ProviderCredentialPayload,
  ) {
    return providerJson<T>(
      url,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } },
      this.config.providerHttpTimeoutMs,
    );
  }

  private async postJson<T>(
    url: string,
    credentials: ProviderCredentialPayload,
    body: Record<string, unknown>,
  ) {
    return providerJson<T>(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      this.config.providerHttpTimeoutMs,
    );
  }

  private validProperty(value: string): string {
    const property = value.trim();
    if (
      !property ||
      (!property.startsWith("sc-domain:") &&
        !property.startsWith("http://") &&
        !property.startsWith("https://"))
    )
      throw new ProviderError(
        "invalid_account",
        "Search Console property is invalid.",
      );
    return property;
  }

  private required(value: string | undefined): string {
    if (!value?.trim())
      throw new ProviderError(
        "provider_not_configured",
        "Google Search Console OAuth is not configured.",
      );
    return value.trim();
  }
}

function splitScopes(value: string): string[] {
  const scopes = value
    .split(/[ ,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return scopes.length ? scopes : [DEFAULT_SCOPE];
}
