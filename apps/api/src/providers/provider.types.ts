import type {
  ProviderAccountSummary,
  ProviderCampaign,
  ProviderDateRange,
  ProviderDefinition,
  ProviderHealthView,
  ProviderId,
  ProviderMetricSummary,
  ProviderProvenance,
} from "@holymedia/contracts";

export type ProviderCredentialPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scopes: string[];
  externalSubjectId?: string;
  displayName?: string;
  providerMetadata?: Record<
    string,
    string | number | boolean | null | Record<string, string>
  >;
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

export type ProviderReadContext = {
  credentials: ProviderCredentialPayload;
  accountId: string;
  currency?: string;
  loginCustomerId?: string;
};

export function isProviderReadAdapter(
  value: unknown,
): value is ProviderOAuthAdapter & ProviderReadAdapter {
  return Boolean(
    value && typeof (value as ProviderReadAdapter).getMetrics === "function",
  );
}

export interface ProviderReadAdapter {
  getAccountSummary(
    context: ProviderReadContext,
    range?: ProviderDateRange,
  ): Promise<ProviderAccountSummary>;
  listCampaigns(
    context: ProviderReadContext,
    range?: ProviderDateRange,
    limit?: number,
    cursor?: string,
  ): Promise<{ items: ProviderCampaign[]; nextCursor?: string }>;
  getMetrics(
    context: ProviderReadContext,
    range: ProviderDateRange,
    campaignId?: string,
  ): Promise<ProviderMetricSummary>;
  health(context: ProviderReadContext): Promise<ProviderHealthView>;
}

export type ProviderCampaignMutation = {
  objectId: string;
  operation: "change_name" | "pause" | "resume";
  payload: Record<string, unknown>;
};

export interface ProviderMutationAdapter {
  mutateCampaign(
    context: ProviderReadContext,
    mutation: ProviderCampaignMutation,
  ): Promise<{ externalObjectId: string }>;
}

export function isProviderMutationAdapter(
  value: unknown,
): value is ProviderOAuthAdapter & ProviderMutationAdapter {
  return Boolean(
    value &&
      typeof (value as ProviderMutationAdapter).mutateCampaign === "function",
  );
}

export type MetaBusiness = {
  id: string;
  name: string | null;
  verificationStatus?: string | null;
  provenance: ProviderProvenance;
};

export type MetaPage = {
  id: string;
  name: string | null;
  category?: string | null;
  linkedInstagram?: { id: string; username: string | null } | null;
  provenance: ProviderProvenance;
};

export interface MetaReadAdapter extends ProviderReadAdapter {
  listBusinesses(
    credentials: ProviderCredentialPayload,
  ): Promise<MetaBusiness[]>;
  listBusinessAdAccounts(
    credentials: ProviderCredentialPayload,
    businessId: string,
  ): Promise<NormalizedProviderAccount[]>;
  listBusinessPages(
    credentials: ProviderCredentialPayload,
    businessId: string,
  ): Promise<MetaPage[]>;
  listPages(credentials: ProviderCredentialPayload): Promise<MetaPage[]>;
  listPagePosts(
    credentials: ProviderCredentialPayload,
    pageId: string,
    limit?: number,
  ): Promise<{
    items: Record<string, unknown>[];
    provenance: ProviderProvenance;
  }>;
  getPageInstagramAccount(
    credentials: ProviderCredentialPayload,
    pageId: string,
  ): Promise<MetaPage>;
}

export type SearchConsoleQueryRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

export interface SearchConsoleReadAdapter extends ProviderOAuthAdapter {
  listProperties(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]>;
  querySearchAnalytics(
    credentials: ProviderCredentialPayload,
    property: string,
    startDate: string,
    endDate: string,
    dimensions: string[],
    rowLimit: number,
  ): Promise<SearchConsoleQueryRow[]>;
  listSitemaps(
    credentials: ProviderCredentialPayload,
    property: string,
  ): Promise<Record<string, unknown>[]>;
}

export function isProviderId(value: string): value is ProviderId {
  return [
    "GOOGLE_ADS",
    "META_ADS",
    "GOOGLE_SEARCH_CONSOLE",
    "YANDEX_DIRECT",
    "TIKTOK_ADS",
    "TEST_PROVIDER",
  ].includes(value);
}
