import type { ProviderDefinition } from "@holymedia/contracts";
import { ProviderError } from "../provider.errors.js";
import type {
  NormalizedProviderAccount,
  OAuthExchangeContext,
  OAuthStartContext,
  ProviderCredentialPayload,
  ProviderOAuthAdapter,
} from "../provider.types.js";

export const testProviderDefinition: ProviderDefinition = {
  id: "TEST_PROVIDER",
  displayName: "Test Provider",
  oauth: true,
  pkce: true,
  accountDiscovery: true,
  refresh: true,
  read: true,
  write: false,
  status: "test_only",
  scopes: ["test.accounts.read"],
};

export class TestProviderAdapter implements ProviderOAuthAdapter {
  public readonly definition = testProviderDefinition;
  public refreshCalls = 0;

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL("https://test-provider.invalid/authorize");
    url.searchParams.set("state", context.state);
    url.searchParams.set("redirect_uri", context.redirectUri);
    if (context.codeChallenge) {
      url.searchParams.set("code_challenge", context.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    if (context.code !== "test-code") {
      throw new ProviderError(
        "authorization_denied",
        "Test authorization was denied.",
      );
    }
    if (!context.codeVerifier) {
      throw new ProviderError(
        "provider_response_invalid",
        "PKCE verification is required.",
      );
    }
    return {
      accessToken: `test-access-${context.code}`,
      refreshToken: "test-refresh-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      tokenType: "Bearer",
      scopes: ["test.accounts.read"],
      externalSubjectId: "test-subject-001",
      displayName: "Test Provider connection",
    };
  }

  public async refreshCredentials(
    credentials: ProviderCredentialPayload,
  ): Promise<ProviderCredentialPayload> {
    if (credentials.refreshToken !== "test-refresh-token") {
      throw new ProviderError(
        "refresh_failed",
        "Provider refresh token was rejected.",
      );
    }
    this.refreshCalls += 1;
    return {
      ...credentials,
      accessToken: `test-refreshed-${this.refreshCalls}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    if (!credentials.accessToken.startsWith("test-")) {
      throw new ProviderError(
        "authentication_failed",
        "Test provider access token was rejected.",
      );
    }
    return [
      {
        externalAccountId: "test-account-001",
        displayName: "Test Provider Account",
        currency: "USD",
        timezone: "UTC",
        status: "ACTIVE",
        metadata: { source: "test-provider" },
      },
      {
        externalAccountId: "test-account-002",
        displayName: "Test Provider Secondary Account",
        currency: "EUR",
        timezone: "Europe/Berlin",
        status: "PAUSED",
      },
    ];
  }
}
