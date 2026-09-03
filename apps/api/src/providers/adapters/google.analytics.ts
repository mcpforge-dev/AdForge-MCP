import { loadConfig, type AppConfig } from "@holymedia/config";
import type { ProviderDefinition } from "@holymedia/contracts";
import { ProviderError } from "../provider.errors.js";
import { providerJson } from "../provider-http.js";
import type {
  GoogleAnalyticsReadAdapter,
  GoogleAnalyticsReportRequest,
  NormalizedProviderAccount,
  OAuthExchangeContext,
  OAuthStartContext,
  ProviderCredentialPayload,
} from "../provider.types.js";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADMIN_URL = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_URL = "https://analyticsdata.googleapis.com/v1beta";

export const googleAnalyticsDefinition = (
  configured: boolean,
): ProviderDefinition => ({
  id: "GOOGLE_ANALYTICS",
  displayName: "Google Analytics",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: true,
  read: configured,
  write: false,
  status: configured ? "available" : "configuration_required",
  scopes: [SCOPE],
});

type AccountSummaries = {
  accountSummaries?: Array<{
    displayName?: string;
    propertySummaries?: Array<{
      property?: string;
      displayName?: string;
      propertyType?: string;
    }>;
  }>;
};

/**
 * GA4 intentionally uses the same generic provider storage only as a container.
 * Its OAuth row, scope and property IDs remain entirely separate from Google Ads.
 */
export class GoogleAnalyticsAdapter implements GoogleAnalyticsReadAdapter {
  public readonly definition: ProviderDefinition;
  private readonly config: AppConfig;

  public constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.definition = googleAnalyticsDefinition(
      Boolean(
        config.providerGoogleAnalyticsClientId &&
        config.providerGoogleAnalyticsClientSecret &&
        config.providerGoogleAnalyticsRedirectUri,
      ),
    );
  }

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set(
      "client_id",
      this.required(this.config.providerGoogleAnalyticsClientId),
    );
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", context.state);
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    const body = new URLSearchParams({
      client_id: this.required(this.config.providerGoogleAnalyticsClientId),
      client_secret: this.required(
        this.config.providerGoogleAnalyticsClientSecret,
      ),
      code: context.code,
      redirect_uri: context.redirectUri,
      grant_type: "authorization_code",
    });
    return this.credentialsFromToken(
      await providerJson<Record<string, unknown>>(
        TOKEN_URL,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        },
        this.config.providerHttpTimeoutMs,
      ),
    );
  }

  public async refreshCredentials(
    credentials: ProviderCredentialPayload,
  ): Promise<ProviderCredentialPayload> {
    if (!credentials.refreshToken)
      throw new ProviderError(
        "refresh_failed",
        "Google Analytics refresh token is unavailable.",
      );
    const body = new URLSearchParams({
      client_id: this.required(this.config.providerGoogleAnalyticsClientId),
      client_secret: this.required(
        this.config.providerGoogleAnalyticsClientSecret,
      ),
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    });
    try {
      return {
        ...credentials,
        ...this.credentialsFromToken(
          await providerJson<Record<string, unknown>>(
            TOKEN_URL,
            {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body,
            },
            this.config.providerHttpTimeoutMs,
          ),
        ),
        refreshToken: credentials.refreshToken,
      };
    } catch (error) {
      throw new ProviderError(
        "refresh_failed",
        "Google Analytics authorization refresh failed.",
        false,
        error instanceof ProviderError ? error.providerStatus : undefined,
        error instanceof ProviderError ? error.providerCode : undefined,
      );
    }
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    const summaries = await this.get<AccountSummaries>(
      `${ADMIN_URL}/accountSummaries?pageSize=200`,
      credentials,
    );
    const candidates = (summaries.accountSummaries ?? []).flatMap((account) =>
      (account.propertySummaries ?? []).flatMap((property) => {
        const id = propertyId(property.property);
        return id
          ? [
              {
                id,
                name: property.displayName ?? `GA4 property ${id}`,
                accountName: account.displayName ?? null,
                propertyType: property.propertyType ?? null,
              },
            ]
          : [];
      }),
    );
    const details = await mapWithConcurrency(
      candidates,
      4,
      async (property) => {
        try {
          const account = await this.getProperty(credentials, property.id);
          return {
            ...account,
            metadata: {
              ...(account.metadata ?? {}),
              accountName: property.accountName,
              propertyType: property.propertyType,
              resourceType: "ga4_property",
            },
          };
        } catch {
          // A summary is still a valid visible property; do not discard it only
          // because optional metadata cannot be read.
          return {
            externalAccountId: property.id,
            displayName: property.name,
            status: "connected",
            metadata: {
              accountName: property.accountName,
              propertyType: property.propertyType,
              resourceType: "ga4_property",
            },
          };
        }
      },
    );
    return [
      ...new Map(
        details.map((value) => [value.externalAccountId, value]),
      ).values(),
    ];
  }

  public async getProperty(
    credentials: ProviderCredentialPayload,
    id: string,
  ): Promise<NormalizedProviderAccount> {
    const property = await this.get<Record<string, unknown>>(
      `${ADMIN_URL}/properties/${encodeURIComponent(this.validPropertyId(id))}`,
      credentials,
    );
    const parent = String(property.parent ?? "");
    return {
      externalAccountId: this.validPropertyId(id),
      displayName: String(property.displayName ?? `GA4 property ${id}`),
      ...(string(property.currencyCode)
        ? { currency: string(property.currencyCode)! }
        : {}),
      ...(string(property.timeZone)
        ? { timezone: string(property.timeZone)! }
        : {}),
      status: "connected",
      metadata: {
        accountResource: parent || null,
        propertyType: string(property.propertyType) ?? null,
        industryCategory: string(property.industryCategory) ?? null,
        serviceLevel: string(property.serviceLevel) ?? null,
        resourceType: "ga4_property",
      },
    };
  }

  public async runReport(
    credentials: ProviderCredentialPayload,
    id: string,
    request: GoogleAnalyticsReportRequest,
  ): Promise<Record<string, unknown>> {
    const body = {
      dateRanges: request.dateRanges,
      dimensions: (request.dimensions ?? []).map((name) => ({ name })),
      metrics: request.metrics.map((name) => ({ name })),
      limit: Math.max(1, Math.min(request.limit ?? 100, 1_000)),
      ...(request.dimensionFilter
        ? { dimensionFilter: request.dimensionFilter }
        : {}),
      ...(request.metricFilter ? { metricFilter: request.metricFilter } : {}),
      ...(request.orderBys?.length ? { orderBys: request.orderBys } : {}),
      returnPropertyQuota: true,
    };
    return this.post(
      `${DATA_URL}/properties/${encodeURIComponent(this.validPropertyId(id))}:runReport`,
      credentials,
      body,
    );
  }

  public async runRealtimeReport(
    credentials: ProviderCredentialPayload,
    id: string,
    dimensions: string[],
    metrics: string[],
    limit = 100,
  ): Promise<Record<string, unknown>> {
    return this.post(
      `${DATA_URL}/properties/${encodeURIComponent(this.validPropertyId(id))}:runRealtimeReport`,
      credentials,
      {
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        limit: Math.max(1, Math.min(limit, 1_000)),
        returnPropertyQuota: true,
      },
    );
  }

  public async checkCompatibility(
    credentials: ProviderCredentialPayload,
    id: string,
    dimensions: string[],
    metrics: string[],
  ): Promise<Record<string, unknown>> {
    return this.post(
      `${DATA_URL}/properties/${encodeURIComponent(this.validPropertyId(id))}:checkCompatibility`,
      credentials,
      {
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
      },
    );
  }

  public async listGoogleAdsLinks(
    credentials: ProviderCredentialPayload,
    id: string,
  ): Promise<Record<string, unknown>[]> {
    const payload = await this.get<{
      googleAdsLinks?: Record<string, unknown>[];
    }>(
      `${ADMIN_URL}/properties/${encodeURIComponent(this.validPropertyId(id))}/googleAdsLinks?pageSize=200`,
      credentials,
    );
    return Array.isArray(payload.googleAdsLinks) ? payload.googleAdsLinks : [];
  }

  public async listCustomDimensionsMetrics(
    credentials: ProviderCredentialPayload,
    id: string,
  ): Promise<Record<string, unknown>> {
    const property = encodeURIComponent(this.validPropertyId(id));
    const [dimensions, metrics] = await Promise.all([
      this.get<{ customDimensions?: Record<string, unknown>[] }>(
        `${ADMIN_URL}/properties/${property}/customDimensions?pageSize=200`,
        credentials,
      ),
      this.get<{ customMetrics?: Record<string, unknown>[] }>(
        `${ADMIN_URL}/properties/${property}/customMetrics?pageSize=200`,
        credentials,
      ),
    ]);
    return {
      customDimensions: dimensions.customDimensions ?? [],
      customMetrics: metrics.customMetrics ?? [],
    };
  }

  private credentialsFromToken(
    payload: Record<string, unknown>,
  ): ProviderCredentialPayload {
    const accessToken = String(payload.access_token ?? "").trim();
    if (!accessToken)
      throw new ProviderError(
        "authentication_failed",
        "Google OAuth did not return an access token.",
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
      tokenType: String(payload.token_type ?? "Bearer"),
      scopes: String(payload.scope ?? SCOPE)
        .split(/\s+/)
        .filter(Boolean),
    };
  }

  private get<T>(
    url: string,
    credentials: ProviderCredentialPayload,
  ): Promise<T> {
    return providerJson<T>(
      url,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } },
      this.config.providerHttpTimeoutMs,
    );
  }

  private post(
    url: string,
    credentials: ProviderCredentialPayload,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return providerJson<Record<string, unknown>>(
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

  private validPropertyId(value: string): string {
    const id = value.replace(/^properties\//, "").trim();
    if (!/^\d{1,20}$/.test(id))
      throw new ProviderError(
        "invalid_account",
        "Google Analytics property ID is invalid.",
      );
    return id;
  }

  private required(value: string | undefined): string {
    if (!value?.trim())
      throw new ProviderError(
        "provider_not_configured",
        "Google Analytics OAuth is not configured.",
      );
    return value.trim();
  }
}

function propertyId(value: unknown): string | null {
  const id = String(value ?? "")
    .replace(/^properties\//, "")
    .trim();
  return /^\d{1,20}$/.test(id) ? id : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const queue = [...values];
  const results: R[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const value = queue.shift();
        if (!value) return;
        results.push(await mapper(value));
      }
    }),
  );
  return results;
}
