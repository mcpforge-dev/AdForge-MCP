import { Injectable } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import type { ProviderDefinition, ProviderId } from "@holymedia/contracts";
import { ProviderError } from "./provider.errors.js";
import type {
  ProviderOAuthAdapter,
  ProviderRegistryEntry,
} from "./provider.types.js";
import { TestProviderAdapter } from "./adapters/test.provider.js";

@Injectable()
export class ProviderRegistry {
  private readonly config = loadConfig();
  private readonly entries: ProviderRegistryEntry[];

  public constructor() {
    this.entries = [
      configuredEntry(
        {
          id: "GOOGLE_ADS",
          displayName: "Google Ads",
          oauth: true,
          pkce: false,
          accountDiscovery: true,
          refresh: true,
          read: false,
          write: false,
          scopes: ["https://www.googleapis.com/auth/adwords"],
        },
        Boolean(
          this.config.providerGoogleClientId &&
          this.config.providerGoogleClientSecret &&
          this.config.providerGoogleRedirectUri,
        ),
      ),
      configuredEntry(
        {
          id: "META_ADS",
          displayName: "Meta Ads",
          oauth: true,
          pkce: false,
          accountDiscovery: true,
          refresh: true,
          read: false,
          write: false,
          scopes: ["ads_read", "business_management"],
        },
        Boolean(
          this.config.providerMetaClientId &&
          this.config.providerMetaClientSecret &&
          this.config.providerMetaRedirectUri,
        ),
      ),
      configuredEntry(
        {
          id: "YANDEX_DIRECT",
          displayName: "Yandex Direct",
          oauth: true,
          pkce: true,
          accountDiscovery: true,
          refresh: true,
          read: false,
          write: false,
          scopes: [],
        },
        false,
      ),
      configuredEntry(
        {
          id: "TIKTOK_ADS",
          displayName: "TikTok Ads",
          oauth: true,
          pkce: true,
          accountDiscovery: true,
          refresh: true,
          read: false,
          write: false,
          scopes: [],
        },
        false,
      ),
      {
        definition: testProviderDefinition(),
        adapter: new TestProviderAdapter(),
      },
    ];
  }

  public list(): ProviderDefinition[] {
    return this.entries
      .filter(({ definition }) =>
        this.config.environment === "production"
          ? definition.id !== "TEST_PROVIDER"
          : true,
      )
      .map(({ definition }) => definition);
  }

  public get(provider: ProviderId): ProviderRegistryEntry {
    if (
      provider === "TEST_PROVIDER" &&
      this.config.environment === "production"
    ) {
      throw new ProviderError(
        "provider_not_configured",
        "Test provider is not available.",
      );
    }
    const entry = this.entries.find(
      ({ definition }) => definition.id === provider,
    );
    if (!entry)
      throw new ProviderError(
        "provider_not_configured",
        "Provider is not supported.",
      );
    return entry;
  }

  public adapter(provider: ProviderId): ProviderOAuthAdapter {
    const entry = this.get(provider);
    if (!entry.adapter) {
      throw new ProviderError(
        "provider_not_configured",
        "Provider OAuth is not configured.",
      );
    }
    return entry.adapter;
  }
}

function configuredEntry(
  definition: Omit<ProviderDefinition, "status">,
  configured: boolean,
): ProviderRegistryEntry {
  return {
    definition: {
      ...definition,
      status: configured ? "available" : "configuration_required",
    },
  };
}

function testProviderDefinition(): ProviderDefinition {
  return {
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
}
