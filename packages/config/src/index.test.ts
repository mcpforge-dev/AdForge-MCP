import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

describe("v2 configuration", () => {
  it("parses the string false as boolean false", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      V2_CONFIG_STRICT: "false",
      DATABASE_URL:
        "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
      REDIS_URL: "redis://localhost:6380",
      CORS_ORIGINS: "http://localhost:3000",
      SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
    });

    expect(config.configStrict).toBe(false);
    expect(config.environment).toBe("test");
  });

  it("enforces strict configuration for production-like environments", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        V2_CONFIG_STRICT: "false",
        DATABASE_URL:
          "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
        REDIS_URL: "redis://localhost:6380",
        CORS_ORIGINS: "https://example.com",
        SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
      }),
    ).toThrow(/Production-like v2 configuration/);
  });

  it("maps existing V1 provider env names without changing callback paths", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      V2_CONFIG_STRICT: "false",
      DATABASE_URL:
        "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
      REDIS_URL: "redis://localhost:6380",
      CORS_ORIGINS: "https://mcp.holymedia.kz",
      SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_OAUTH_CLIENT_ID: "google-client",
      AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN: "developer-token",
      AD_MCP_GOOGLE_OAUTH_REDIRECT_PATH: "/oauth/google/callback",
      AD_MCP_META_OAUTH_APP_ID: "meta-app",
      AD_MCP_META_OAUTH_APP_SECRET: "meta-secret",
      AD_MCP_META_OAUTH_REDIRECT_PATH: "/oauth/meta/callback",
    });

    expect(config.providerGoogleClientId).toBe("google-client");
    expect(config.providerGoogleRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/google/callback",
    );
    expect(config.providerMetaClientId).toBe("meta-app");
    expect(config.providerMetaRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/meta/callback",
    );
  });
});
