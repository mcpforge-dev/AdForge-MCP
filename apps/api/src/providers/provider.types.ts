import type { ProviderDefinition, ProviderId } from "@holymedia/contracts";

export type ProviderCredentialPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scopes: string[];
  externalSubjectId?: string;
  displayName?: string;
  providerMetadata?: Record<string, string | number | boolean | null>;
};

export type NormalizedProviderAccount = {
  externalAccountId: string;
  displayName: string;
  currency?: string;
  timezone?: string;
  status?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type OAuthStartContext = {
  state: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
};

export type OAuthExchangeContext = {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

export interface ProviderOAuthAdapter {
  readonly definition: ProviderDefinition;
  authorizationUrl(context: OAuthStartContext): string;
  exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload>;
  refreshCredentials?(
    credentials: ProviderCredentialPayload,
  ): Promise<ProviderCredentialPayload>;
  revokeCredentials?(credentials: ProviderCredentialPayload): Promise<void>;
  discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]>;
}

export type ProviderErrorCode =
  | "authentication_failed"
  | "authorization_denied"
  | "insufficient_permissions"
  | "token_expired"
  | "refresh_failed"
  | "provider_unavailable"
  | "rate_limited"
  | "invalid_account"
  | "account_disabled"
  | "connection_revoked"
  | "provider_response_invalid"
  | "provider_not_configured"
  | "invalid_oauth_state";

export type ProviderRegistryEntry = {
  definition: ProviderDefinition;
  adapter?: ProviderOAuthAdapter;
};

export type ProviderScopeMetadata = {
  requestedScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
};

export function isProviderId(value: string): value is ProviderId {
  return [
    "GOOGLE_ADS",
    "META_ADS",
    "YANDEX_DIRECT",
    "TIKTOK_ADS",
    "TEST_PROVIDER",
  ].includes(value);
}
