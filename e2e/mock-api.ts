import { randomUUID } from "node:crypto";
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
  const origin = route.request().headers().origin ?? "http://localhost:3000";
  await route.fulfill({
    status: 200,
    headers: {
      ...cors,
      "access-control-allow-origin": origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

type MockServiceToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  accountIds: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export async function installMockApi(page: Page) {
  const now = Date.now();
  const tokens: MockServiceToken[] = [
    {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Personal MCP token",
      tokenPrefix: "hmst_legacy",
      scopes: ["adforge:mcp:read"],
      accountIds: [accounts[0].id],
      createdAt: new Date(now - 3 * 86_400_000).toISOString(),
      expiresAt: new Date(now + 27 * 86_400_000).toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    },
    {
      id: "66666666-6666-4666-8666-666666666665",
      name: "Old client",
      tokenPrefix: "hmst_expired",
      scopes: ["adforge:mcp:read"],
      accountIds: [accounts[0].id],
      createdAt: new Date(now - 90 * 86_400_000).toISOString(),
      expiresAt: new Date(now - 2 * 86_400_000).toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    },
  ];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-origin":
            request.headers().origin ?? "http://localhost:3000",
        },
      });
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
              overview: {
                verdict: "Страница доступна, но ей нужны базовые правки.",
                mainRisk: "Проверьте главный заголовок",
                quickWin: "Добавьте один главный H1",
              },
              scores: [
                {
                  id: "first-screen",
                  label: "Первый экран",
                  value: 70,
                  description: "",
                },
                {
                  id: "structure",
                  label: "Структура",
                  value: 80,
                  description: "",
                },
                {
                  id: "mobile",
                  label: "Мобильная версия",
                  value: 90,
                  description: "",
                },
                {
                  id: "technical",
                  label: "Техническая основа",
                  value: 80,
                  description: "",
                },
              ],
              topIssues: [
                {
                  priority: "P1",
                  title: "Проверьте главный заголовок",
                  problem: "На странице должен быть один понятный H1.",
                  evidence: "H1 не найден.",
                  recommendation: "Сформулируйте один главный заголовок.",
                },
              ],
              quickWins: [{ title: "Добавьте один главный H1" }],
              hero: {
                h1: "Получите консультацию",
                subtitle: "Помогите посетителю понять вашу пользу.",
                cta: "Добавьте понятную кнопку действия",
              },
              structure: ["Первый экран", "Доказательства"],
              oneDayPlan: [{ step: 1, title: "Добавьте один главный H1" }],
              evidence: { limitations: "Анализирует HTML публичной страницы." },
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
        {
          id: "66666666-6666-4666-8666-666666666666",
          provider: "GOOGLE_ADS",
          displayName: "Historical Google",
          status: "DISCONNECTED",
          accounts: [
            {
              id: "77777777-7777-4777-8777-777777777777",
              externalAccountId: "123456",
              displayName: "Исторический кабинет",
              enabled: true,
              status: "ENABLED",
            },
          ],
        },
      ]);
    if (path.includes("/reports/performance") && request.method() === "GET")
      return json(route, {
        account: {
          provider: "META_ADS",
          externalAccountId: accounts[0].externalAccountId,
          name: accounts[0].displayName,
          currency: "USD",
          timezone: "UTC",
        },
        period: { startDate: "2026-01-01", endDate: "2026-01-07" },
        metrics: {
          spend: { amount: "10", currency: "USD" },
          impressions: 100,
          clicks: 10,
          conversions: 1,
        },
        campaigns: [],
        provenance: { summary: { realData: true } },
      });
    if (
      path.endsWith(`/connections/${connectionId}/accounts`) &&
      request.method() === "PATCH"
    ) {
      const body = request.postDataJSON() as { accountIds?: string[] };
      const selected = new Set(body.accountIds ?? []);
      for (const account of accounts)
        account.enabled = selected.has(account.id);
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
      return json(route, tokens);
    if (path.endsWith("/service-tokens") && request.method() === "POST") {
      const input = request.postDataJSON() as {
        name: string;
        accountIds?: string[];
        scopes?: string[];
        expiresInDays?: number;
      };
      const created: MockServiceToken = {
        id: randomUUID(),
        name: input.name,
        tokenPrefix: "hmst_generated",
        scopes: input.scopes ?? ["adforge:mcp:read"],
        accountIds: input.accountIds ?? [],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + (input.expiresInDays ?? 90) * 86_400_000,
        ).toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      };
      tokens.unshift(created);
      return json(route, { ...created, token: `hmst_${randomUUID()}` });
    }
    const tokenMatch = path.match(/\/service-tokens\/([^/]+)(?:\/(rotate))?$/);
    if (tokenMatch) {
      const [, tokenId, action] = tokenMatch;
      const current = tokens.find((token) => token.id === tokenId);
      if (!current) return route.fulfill({ status: 404 });

      if (request.method() === "PATCH") {
        const input = request.postDataJSON() as { name: string };
        current.name = input.name;
        return json(route, current);
      }
      if (request.method() === "DELETE") {
        current.revokedAt = new Date().toISOString();
        return json(route, { success: true });
      }
      if (request.method() === "POST" && action === "rotate") {
        current.revokedAt = new Date().toISOString();
        const input = request.postDataJSON() as { expiresInDays?: number };
        const replacement: MockServiceToken = {
          ...current,
          id: randomUUID(),
          tokenPrefix: "hmst_rotated",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(
            Date.now() + (input.expiresInDays ?? 90) * 86_400_000,
          ).toISOString(),
          revokedAt: null,
        };
        tokens.unshift(replacement);
        return json(route, { ...replacement, token: `hmst_${randomUUID()}` });
      }
    }
    return json(route, { success: true });
  });
}
