import type { Page, Route } from "@playwright/test";

const workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "HolyMedia",
  slug: "holymedia",
  role: "OWNER",
};
const connectionId = "22222222-2222-4222-8222-222222222222";
const accounts = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    externalAccountId: "act_123",
    displayName: "Основной рекламный кабинет",
    enabled: true,
    status: "ENABLED",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    externalAccountId: "act_456",
    displayName: "Новый проект",
    enabled: false,
    status: "ENABLED",
  },
];
const cors = {
  "access-control-allow-origin": "http://localhost:3000",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type,x-csrf-token",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
};

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    headers: { ...cors, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function installMockApi(page: Page) {
  if (process.env.V2_E2E_MOCK !== "true") return;
  await page.route("http://localhost:4000/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (path === "/api/v1/auth/csrf")
      return json(route, { csrfToken: "mock-csrf" });
    if (["/api/v1/auth/login", "/api/v1/auth/signup"].includes(path))
      return json(route, {
        user: { name: "Анна", email: "phase-b-legacy-user@example.test" },
      });
    if (
      path === "/api/v1/auth/logout" ||
      path === "/api/v1/auth/password/change"
    )
      return json(route, { success: true });
    if (path === "/api/v1/workspaces") return json(route, [workspace]);
    if (path === "/api/profile" && request.method() === "GET")
      return json(route, {
        profile: { name: "Анна", email: "phase-b-legacy-user@example.test" },
      });
    if (path === "/api/profile" && request.method() === "PUT")
      return json(route, {
        profile: { name: "Анна", email: "phase-b-legacy-user@example.test" },
      });
    if (path === "/api/profile/avatar") return json(route, { dataUrl: null });
    if (path === "/api/site/history")
      return json(route, {
        items: [
          {
            id: "analysis-1",
            url: "https://example.com",
            result: {
              status: 200,
              title: "Example",
              h1Count: 1,
              linkCount: 4,
              checks: {
                https: true,
                hasTitle: true,
                hasDescription: false,
                hasSingleH1: true,
              },
            },
            created_at: new Date().toISOString(),
          },
        ],
      });
    if (path.includes("/site-analysis"))
      return json(route, { status: 200, title: "Example" });
    if (path === "/api/site/report.docx" && request.method() === "POST")
      return route.fulfill({
        status: 200,
        headers: {
          ...cors,
          "content-type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        body: "PK-test",
      });
    if (path === "/api/v1/providers")
      return json(
        route,
        [
          ["GOOGLE_ADS", "Google Ads"],
          ["META_ADS", "Meta Ads"],
          ["YANDEX_DIRECT", "Yandex Direct"],
          ["TIKTOK_ADS", "TikTok Ads"],
          ["GOOGLE_SEARCH_CONSOLE", "Google Search Console"],
        ].map(([id, displayName]) => ({
          id,
          displayName,
          status: "AVAILABLE",
          oauth: true,
        })),
      );
    if (path === `/api/v1/workspaces/${workspace.id}/connections`)
      return json(route, [
        {
          id: connectionId,
          provider: "META_ADS",
          displayName: "Anna Meta",
          status: "CONNECTED",
          accounts,
        },
      ]);
    if (path.includes("/provider-accounts/") && request.method() === "PATCH") {
      const account = accounts.find((item) => path.endsWith(`/${item.id}`));
      if (account) {
        const body = request.postDataJSON() as { enabled?: boolean };
        account.enabled = Boolean(body.enabled);
      }
      return json(route, { success: true });
    }
    if (path.endsWith("/accounts/discover"))
      return json(route, { success: true });
    if (
      path.endsWith(`/connections/${connectionId}`) &&
      request.method() === "DELETE"
    )
      return json(route, { success: true });
    if (path.endsWith("/service-tokens") && request.method() === "GET")
      return json(route, []);
    if (path.endsWith("/service-tokens") && request.method() === "POST")
      return json(route, {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Playwright client",
        tokenPrefix: "hm_test",
        token: "mock-one-time-token",
        scopes: ["adforge:mcp:read"],
        accountIds: [accounts[0]?.id],
        createdAt: new Date().toISOString(),
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      });
    return json(route, { success: true });
  });
}
