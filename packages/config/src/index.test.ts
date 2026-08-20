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
});
