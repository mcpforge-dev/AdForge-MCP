import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "./adapters/google.ads.js";
import { MetaAdsAdapter } from "./adapters/meta.ads.js";
import { TikTokAdsAdapter } from "./adapters/tiktok.ads.js";
import { YandexDirectAdapter } from "./adapters/yandex.direct.js";
import { GoogleSearchConsoleAdapter } from "./adapters/google.search-console.js";
import {
  googleAccessibleCustomersFixture,
  googleCampaignFixture,
  googleCustomerHierarchyFixture,
  googleManagerClientsFixture,
} from "./fixtures/google-ads.fixture.js";
import {
  metaAdAccountsFixture,
  metaPagesFixture,
  metaPostsFixture,
} from "./fixtures/meta-ads.fixture.js";

const config = loadConfig({
  NODE_ENV: "test",
  PROVIDER_GOOGLE_CLIENT_ID: "google-client",
  PROVIDER_GOOGLE_CLIENT_SECRET: "google-secret",
  PROVIDER_GOOGLE_REDIRECT_URI: "https://v2.example.test/oauth/google/callback",
  PROVIDER_GOOGLE_DEVELOPER_TOKEN: "developer-token",
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "1234567890",
  PROVIDER_META_CLIENT_ID: "meta-client",
  PROVIDER_META_CLIENT_SECRET: "meta-secret",
  PROVIDER_META_REDIRECT_URI: "https://v2.example.test/oauth/meta/callback",
  PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "search-console-client",
  PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "search-console-secret",
  PROVIDER_GOOGLE_SEARCH_CONSOLE_REDIRECT_URI:
    "https://v2.example.test/oauth/google-search-console/callback",
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Google Ads v2 adapter", () => {
  it("builds OAuth URL with the adwords scope and discovers manager clients", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(googleAccessibleCustomersFixture))
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture))
      .mockResolvedValueOnce(jsonResponse(googleManagerClientsFixture));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAdsAdapter(config);
    const url = new URL(
      adapter.authorizationUrl({
        state: "state",
        redirectUri: config.providerGoogleRedirectUri!,
      }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/adwords",
    );
    const accounts = await adapter.discoverAccounts({
      accessToken: "access",
      scopes: ["https://www.googleapis.com/auth/adwords"],
    });
    expect(accounts.map((account) => account.externalAccountId)).toEqual([
      "1234567890",
      "2345678901",
    ]);
    expect(accounts[1]?.currency).toBe("KZT");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes campaign budgets from micros and keeps read responses source-backed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(googleCampaignFixture)),
    );
    const adapter = new GoogleAdsAdapter(config);
    const result = await adapter.listCampaigns(
      {
        credentials: {
          accessToken: "access",
          scopes: ["https://www.googleapis.com/auth/adwords"],
        },
        accountId: "1234567890",
      },
      { startDate: "2026-01-01", endDate: "2026-01-07" },
    );
    expect(result.items[0]?.budget).toEqual({ amount: "2.5", currency: "USD" });
    expect(result.items[0]?.provenance).toMatchObject({
      provider: "GOOGLE_ADS",
      realData: true,
      dataStatus: "live",
    });
  });
});

describe("Meta Ads v2 adapter", () => {
  it("discovers ad accounts and follows Page to Instagram through the Page edge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metaAdAccountsFixture))
      .mockResolvedValueOnce(jsonResponse(metaPagesFixture))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "110901223663187", access_token: "page-token" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(metaPostsFixture))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "110901223663187", access_token: "page-token" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "110901223663187",
          name: "Личное страхование",
          instagram_business_account: {
            id: "17841479968382405",
            username: "saqta_market.kz",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new MetaAdsAdapter(config);
    const credentials = {
      accessToken: "user-token",
      scopes: [
        "ads_read",
        "business_management",
        "pages_show_list",
        "pages_read_engagement",
      ],
    };
    const accounts = await adapter.discoverAccounts(credentials);
    expect(accounts[0]?.externalAccountId).toBe("act_1423247033195473");
    const pages = await adapter.listPages(credentials);
    expect(pages[0]?.linkedInstagram).toEqual({
      id: "17841479968382405",
      username: "saqta_market.kz",
    });
    const posts = await adapter.listPagePosts(credentials, "110901223663187");
    expect(posts.items).toHaveLength(1);
    const instagram = await adapter.getPageInstagramAccount(
      credentials,
      "110901223663187",
    );
    expect(instagram.linkedInstagram?.username).toBe("saqta_market.kz");
    expect(posts.provenance.sourceApi).toContain("published_posts");
  });
});

describe("V1 partner OAuth adapters", () => {
  it("keeps Yandex Direct callback and client discovery contract", async () => {
    const partnerConfig = loadConfig({
      NODE_ENV: "test",
      PROVIDER_YANDEX_CLIENT_ID: "yandex-client",
      PROVIDER_YANDEX_CLIENT_SECRET: "yandex-secret",
      PROVIDER_YANDEX_REDIRECT_URI:
        "https://mcp.example.test/oauth/yandex/callback",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "yandex-access",
          refresh_token: "yandex-refresh",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            Clients: [
              {
                Login: "123456",
                ClientInfo: "Yandex client",
                Currency: "RUB",
                Archived: "NO",
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new YandexDirectAdapter(partnerConfig);
    const url = new URL(
      adapter.authorizationUrl({
        state: "state",
        redirectUri: partnerConfig.providerYandexRedirectUri!,
      }),
    );
    expect(url.hostname).toBe("oauth.yandex.ru");
    expect(url.pathname).toBe("/authorize");
    const credentials = await adapter.exchangeCode({
      code: "code",
      redirectUri: partnerConfig.providerYandexRedirectUri!,
    });
    const accounts = await adapter.discoverAccounts(credentials);
    expect(accounts[0]).toMatchObject({
      externalAccountId: "123456",
      currency: "RUB",
      status: "active",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps TikTok advertiser discovery read-only and does not expose app secret", async () => {
    const partnerConfig = loadConfig({
      NODE_ENV: "test",
      PROVIDER_TIKTOK_CLIENT_ID: "tiktok-client",
      PROVIDER_TIKTOK_CLIENT_SECRET: "tiktok-secret",
      PROVIDER_TIKTOK_REDIRECT_URI:
        "https://mcp.example.test/oauth/tiktok/callback",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            access_token: "tiktok-access",
            refresh_token: "tiktok-refresh",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            advertiser_ids: [
              { advertiser_id: "adv-1", advertiser_name: "TikTok client" },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new TikTokAdsAdapter(partnerConfig);
    const credentials = await adapter.exchangeCode({
      code: "code",
      redirectUri: partnerConfig.providerTikTokRedirectUri!,
    });
    expect(credentials).not.toHaveProperty("clientSecret");
    const accounts = await adapter.discoverAccounts(credentials);
    expect(accounts).toEqual([
      expect.objectContaining({
        externalAccountId: "adv-1",
        displayName: "TikTok client",
      }),
    ]);
  });
});

describe("Google Search Console v2 adapter", () => {
  it("preserves the V1 callback, discovers properties, and reads analytics", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          siteEntry: [
            {
              siteUrl: "https://holymedia.kz/",
              permissionLevel: "siteOwner",
            },
            {
              siteUrl: "sc-domain:holymedia.kz",
              permissionLevel: "siteFullUser",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          rows: [
            {
              keys: ["holy media"],
              clicks: 12,
              impressions: 240,
              ctr: 0.05,
              position: 3.2,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sitemap: [{ path: "https://holymedia.kz/sitemap.xml" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleSearchConsoleAdapter(config);
    const url = new URL(
      adapter.authorizationUrl({
        state: "state",
        redirectUri: config.providerGoogleSearchConsoleRedirectUri!,
      }),
    );
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    const credentials = { accessToken: "search-access", scopes: [] };
    const properties = await adapter.discoverAccounts(credentials);
    expect(properties[0]).toMatchObject({
      externalAccountId: "https://holymedia.kz/",
      displayName: "https://holymedia.kz/",
    });
    const rows = await adapter.querySearchAnalytics(
      credentials,
      "https://holymedia.kz/",
      "2026-01-01",
      "2026-01-07",
      ["query"],
      25,
    );
    expect(rows[0]?.clicks).toBe(12);
    const sitemaps = await adapter.listSitemaps(
      credentials,
      "https://holymedia.kz/",
    );
    expect(sitemaps[0]?.path).toContain("sitemap.xml");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
