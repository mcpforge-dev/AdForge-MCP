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

  it("parses confirmed-write allowlists without enabling writes", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      V2_PREVIEW_ONLY: "true",
      V2_CONFIRMED_WRITE_ENABLED: "false",
      V2_WRITE_ACCOUNT_ALLOWLIST: "act_1, act_2",
      V2_WRITE_OBJECT_ALLOWLIST: "campaign-1",
      V2_WRITE_OPERATION_ALLOWLIST: "change_name",
    });
    expect(config.previewOnly).toBe(true);
    expect(config.confirmedWriteEnabled).toBe(false);
    expect(config.writeAccountAllowlist).toEqual(["act_1", "act_2"]);
    expect(config.writeObjectAllowlist).toEqual(["campaign-1"]);
    expect(config.writeOperationAllowlist).toEqual(["change_name"]);
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

  it("maps V1 Yandex and TikTok configuration without changing callback paths", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_TIKTOK_OAUTH_APP_ID: "tiktok-app",
      AD_MCP_TIKTOK_OAUTH_APP_SECRET: "tiktok-secret",
      AD_MCP_TIKTOK_OAUTH_REDIRECT_PATH: "/oauth/tiktok/callback",
      AD_MCP_YANDEX_OAUTH_CLIENT_ID: "yandex-client",
      AD_MCP_YANDEX_OAUTH_CLIENT_SECRET: "yandex-secret",
      AD_MCP_YANDEX_OAUTH_REDIRECT_PATH: "/oauth/yandex/callback",
    });

    expect(config.providerTikTokClientId).toBe("tiktok-app");
    expect(config.providerTikTokRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/tiktok/callback",
    );
    expect(config.providerYandexClientId).toBe("yandex-client");
    expect(config.providerYandexRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/yandex/callback",
    );
  });

  it("maps the existing Search Console callback without creating a new OAuth contract", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_OAUTH_CLIENT_ID: "google-client",
      AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      AD_MCP_GOOGLE_SEARCH_CONSOLE_SCOPES:
        "https://www.googleapis.com/auth/webmasters.readonly",
      AD_MCP_GOOGLE_SEARCH_CONSOLE_REDIRECT_PATH:
        "/oauth/google-search-console/callback",
    });

    expect(config.providerGoogleSearchConsoleClientId).toBe("google-client");
    expect(config.providerGoogleSearchConsoleRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/google-search-console/callback",
    );
    expect(config.providerGoogleSearchConsoleScopes).toContain(
      "webmasters.readonly",
    );
  });

  it("maps the legacy Google Login client and callback", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_LOGIN_CLIENT_ID: "login-client",
      AD_MCP_GOOGLE_LOGIN_CLIENT_SECRET: "login-secret",
      AD_MCP_GOOGLE_LOGIN_REDIRECT_PATH: "/auth/google/callback",
    });

    expect(config.providerGoogleLoginClientId).toBe("login-client");
    expect(config.providerGoogleLoginClientSecret).toBe("login-secret");
    expect(config.providerGoogleLoginRedirectUri).toBe(
      "https://mcp.holymedia.kz/auth/google/callback",
    );
  });
});
