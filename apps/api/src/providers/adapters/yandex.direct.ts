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

export const yandexDirectDefinition = (
  configured: boolean,
): ProviderDefinition => ({
  id: "YANDEX_DIRECT",
  displayName: "Yandex Direct",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: false,
  read: false,
  write: false,
  status: configured ? "available" : "configuration_required",
  scopes: ["direct:api"],
});

type YandexResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  result?: { Clients?: Array<Record<string, unknown>> };
};

export class YandexDirectAdapter implements ProviderOAuthAdapter {
  public readonly definition: ProviderDefinition;
  private readonly config: AppConfig;

  public constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.definition = yandexDirectDefinition(
      Boolean(
        config.providerYandexClientId &&
        config.providerYandexClientSecret &&
        config.providerYandexRedirectUri,
      ),
    );
  }

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL(this.required(this.config.providerYandexAuthUri));
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "client_id",
      this.required(this.config.providerYandexClientId),
    );
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("scope", this.config.providerYandexScope);
    url.searchParams.set("state", context.state);
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: context.code,
      client_id: this.required(this.config.providerYandexClientId),
      client_secret: this.required(this.config.providerYandexClientSecret),
      redirect_uri: context.redirectUri,
    });
    const payload = await providerJson<YandexResponse>(
      this.required(this.config.providerYandexTokenUri),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      20_000,
    );
    const accessToken = String(payload.access_token ?? "").trim();
    if (!accessToken)
      throw new ProviderError(
        "provider_response_invalid",
        "Yandex OAuth token exchange returned no access token.",
      );
    return {
      accessToken,
      ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
      ...(payload.expires_in
        ? {
            expiresAt: new Date(
              Date.now() + payload.expires_in * 1000,
            ).toISOString(),
          }
        : {}),
      tokenType: "Bearer",
      scopes: [this.config.providerYandexScope],
    };
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    const payload = await providerJson<YandexResponse>(
      this.required(this.config.providerYandexClientsUri),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          "accept-language": "en",
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          method: "get",
          params: {
            FieldNames: ["Login", "ClientInfo", "Currency", "Archived"],
          },
        }),
      },
      20_000,
    );
    const clients = Array.isArray(payload.result?.Clients)
      ? payload.result.Clients
      : [];
    const accounts: NormalizedProviderAccount[] = [];
    for (const client of clients) {
      const login = String(client.Login ?? "").trim();
      const archived = String(client.Archived ?? "").toUpperCase() === "YES";
      if (!login) continue;
      accounts.push({
        externalAccountId: login,
        displayName: String(client.ClientInfo ?? `Yandex Direct ${login}`),
        ...(client.Currency ? { currency: String(client.Currency) } : {}),
        status: archived ? "archived" : "active",
        metadata: {
          source: "Yandex Direct API",
          login: this.config.providerYandexLogin ?? null,
          archived,
        },
      });
    }
    if (accounts.length > 0) return accounts;
    const fallback =
      this.config.providerYandexClientLogin ?? this.config.providerYandexLogin;
    if (!fallback) return [];
    return [
      {
        externalAccountId: fallback,
        displayName: `Yandex Direct ${fallback}`,
        status: "unknown",
        metadata: { source: "Yandex Direct configuration fallback" },
      },
    ];
  }

  private required(value: string | undefined): string {
    if (!value)
      throw new ProviderError(
        "provider_not_configured",
        "Yandex Direct is not configured.",
      );
    return value;
  }
}
