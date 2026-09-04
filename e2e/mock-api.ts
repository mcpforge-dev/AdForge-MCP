import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";

const workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "HolyMedia",
  slug: "holymedia",
  role: "OWNER",
  accessStatus: "ACTIVE",
};
const company = {
  ...workspace,
  legalName: "HolyMedia LLP",
  registrationNumber: "123456789012",
  registrationCountry: "KZ",
  legalAddress: null,
  companyPhone: null,
  companyEmail: "phase-b-legacy-user@example.test",
  websiteUrl: null,
  onboardingCompletedAt: null,
};
const members = [
  {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "OWNER",
    createdAt: "2026-01-01T00:00:00.000Z",
    user: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Анна",
      email: "phase-b-legacy-user@example.test",
      emailVerifiedAt: null,
    },
  },
];
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

function mockSiteAudit(id: string, url: string) {
  return {
    id,
    normalizedUrl: url,
    status: "COMPLETED",
    stage: "completed",
    progress: 100,
    pagesFound: 3,
    pagesChecked: 3,
    coverageSampled: false,
    elapsedMs: 12_000,
    createdAt: new Date().toISOString(),
    scores: [
      {
        id: "seo",
        label: "SEO",
        value: 62,
        passed: 9,
        applicable: 14,
        origin: "weighted deterministic checks",
      },
      {
        id: "accessibility",
        label: "Доступность",
        value: 71,
        passed: 4,
        applicable: 6,
        origin: "axe",
      },
    ],
    issueCounts: { P1: 1, P2: 1 },
    summary: {
      executiveSummary:
        "Проверено 3 страницы. Сначала исправьте видимость главного действия.",
      methodology: "Проверки измерены или вычислены.",
      fieldData: "Недостаточно полевых данных.",
      gsc: "Search Console не подключена — поисковые данные не учитывались.",
    },
    findings: [
      {
        id: "finding-1",
        severity: "P1",
        category: "ux",
        evidenceKind: "MEASURED",
        title: "CTA теряется на первом экране",
        finding: "Главное действие не видно.",
        location: url,
        evidence: "CTA не найден.",
        impact: "Пользователь не понимает следующий шаг.",
        recommendation: "Добавьте заметную кнопку.",
        ownerRole: "Дизайнер",
        effort: "1–2 часа",
      },
      {
        id: "finding-2",
        severity: "P2",
        category: "seo",
        evidenceKind: "COMPUTED",
        title: "Canonical не настроен",
        finding: "Не найден canonical.",
        location: url,
        evidence: "rel=canonical отсутствует.",
        impact: "Возможны дубли.",
        recommendation: "Укажите canonical.",
        ownerRole: "SEO",
        effort: "15 минут",
      },
    ],
    screenshots: [
      {
        kind: "DESKTOP_SCREENSHOT",
        domMap: [
          {
            label: "Hero",
            selector: "h1",
            text: "Понятный оффер",
            box: { x: 80, y: 180, width: 640, height: 160 },
          },
        ],
      },
    ],
  };
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

export async function installMockApi(
  page: Page,
  options: { adminPassword?: string } = {},
) {
  const now = Date.now();
  const adminPassword = options.adminPassword ?? randomUUID();
  let adminAuthenticated = false;
  const adminCompany = {
    id: workspace.id,
    name: "HolyMedia",
    legalName: "HolyMedia LLP",
    registrationNumber: "123456789012",
    registrationCountry: "KZ",
    legalAddress: "Almaty",
    companyPhone: "+7 700 000 0000",
    companyEmail: "phase-b-legacy-user@example.test",
    accessStatus: "PENDING",
    createdAt: new Date(now - 86_400_000).toISOString(),
  };
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
  const tariffRequests: Array<Record<string, unknown>> = [];
  const supportRequests: Array<Record<string, unknown>> = [];
  const siteAudits: Array<Record<string, unknown>> = [];

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
    if (path === "/api/v1/admin/auth/login") {
      const body = request.postDataJSON() as {
        login?: string;
        password?: string;
      };
      if (body.login !== "Admin" || body.password !== adminPassword)
        return route.fulfill({ status: 401, headers: cors });
      adminAuthenticated = true;
      return json(route, { authenticated: true });
    }
    if (path === "/api/v1/admin/auth/logout") {
      adminAuthenticated = false;
      return json(route, { success: true });
    }
    if (path === "/api/v1/admin/session") {
      return json(route, { authenticated: adminAuthenticated });
    }
    if (path === "/api/v1/admin/overview")
      return json(route, {
        companies: { total: 2, pending: 1, active: 1, suspended: 0 },
        users: 3,
        connections: { active: 1, attention: 0 },
        health: {
          api: "ok",
          web: "not_probed",
          worker: "not_probed",
          postgres: "ok",
          redis: "ok",
        },
        latestAudit: [
          {
            id: "audit-1",
            eventType: "company_profile_updated",
            success: true,
            createdAt: new Date(now).toISOString(),
          },
        ],
        support: [],
      });
    if (path === "/api/v1/admin/companies")
      return json(route, {
        companies: [
          {
            ...adminCompany,
            memberships: [
              {
                user: {
                  name: "Анна",
                  email: "phase-b-legacy-user@example.test",
                },
              },
            ],
            subscriptions: [],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    if (path === `/api/v1/admin/companies/${workspace.id}`)
      return json(route, {
        ...adminCompany,
        memberships: [
          {
            role: "OWNER",
            user: {
              id: members[0].user.id,
              name: "Анна",
              email: "phase-b-legacy-user@example.test",
              status: "active",
            },
          },
        ],
        invitations: [
          {
            id: "invite-1",
            email: "colleague@example.test",
            role: "MEMBER",
            expiresAt: new Date(now + 86_400_000).toISOString(),
          },
        ],
        connections: [
          {
            id: connectionId,
            provider: "META_ADS",
            status: "CONNECTED",
            _count: { accounts: 2 },
          },
        ],
        selectedAccountCount: 1,
        subscriptions: [],
        entitlements: [],
        auditEvents: [],
      });
    if (
      path === `/api/v1/admin/companies/${workspace.id}/access` &&
      request.method() === "PATCH"
    ) {
      const body = request.postDataJSON() as { status: string };
      adminCompany.accessStatus = body.status;
      return json(route, {
        company: { id: workspace.id, accessStatus: body.status },
      });
    }
    if (
      path === `/api/v1/admin/companies/${workspace.id}/access/full-lifetime` &&
      ["POST", "DELETE"].includes(request.method())
    ) {
      return json(route, {
        access: request.method() === "POST" ? "full_lifetime" : "none",
      });
    }
    if (path === "/api/v1/admin/users")
      return json(route, {
        users: [
          {
            id: members[0].user.id,
            name: "Анна",
            email: "phase-b-legacy-user@example.test",
            status: "active",
            memberships: [
              {
                role: "OWNER",
                workspace: {
                  id: workspace.id,
                  name: "HolyMedia",
                  accessStatus: "PENDING",
                },
              },
            ],
            sessions: [],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    if (path === `/api/v1/admin/users/${members[0].user.id}/access`)
      return json(route, { success: true });
    if (path === "/api/v1/admin/diagnostics")
      return json(route, {
        connections: [
          {
            id: connectionId,
            provider: "META_ADS",
            status: "CONNECTED",
            workspace: { id: workspace.id, name: "HolyMedia" },
            _count: { accounts: 2 },
            lastErrorCode: null,
          },
        ],
        tokens: [],
        reports: [],
      });
    if (path === "/api/v1/admin/support")
      return json(route, { requests: [], feedbackRequests: supportRequests });
    if (
      path.startsWith("/api/v1/admin/support/feedback/") &&
      request.method() === "PATCH"
    ) {
      const id = path.split("/").at(-1);
      const item = supportRequests.find((request) => request.id === id);
      if (item)
        item.status = (request.postDataJSON() as { status: string }).status;
      return json(route, { request: item });
    }
    if (path === "/api/v1/admin/tariff-requests")
      return json(route, { requests: tariffRequests });
    if (path === "/api/v1/admin/audit")
      return json(route, { events: [], total: 0, page: 1, pageSize: 25 });
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
    if (path === `/api/v1/workspaces/${workspace.id}`)
      return json(route, company);
    if (path === `/api/v1/workspaces/${workspace.id}/members`)
      return json(route, members);
    if (path === `/api/v1/workspaces/${workspace.id}/invitations`)
      return json(route, []);
    if (path === `/api/v1/workspaces/${workspace.id}/billing/subscription`)
      return json(route, null);
    if (
      path === `/api/v1/workspaces/${workspace.id}/support-requests` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as {
        category: string;
        message: string;
        sourceRoute?: string;
        locale?: string;
        idempotencyKey?: string;
      };
      const existing = supportRequests.find(
        (item) => item.idempotencyKey === body.idempotencyKey,
      );
      if (existing)
        return json(route, {
          request: existing,
          created: false,
          telegramDelivered: true,
          telegramMessageId: existing.telegramMessageId,
        });
      const item = {
        id: `support-request-${supportRequests.length + 1}`,
        idempotencyKey: body.idempotencyKey,
        category: body.category,
        message: body.message,
        sourceRoute: body.sourceRoute ?? "/dashboard",
        locale: body.locale ?? "ru",
        status: "NEW",
        telegramDeliveryStatus: "SENT",
        telegramMessageId: "77",
        createdAt: new Date().toISOString(),
        workspace: { id: workspace.id, name: workspace.name },
        user: {
          id: members[0].user.id,
          name: members[0].user.name,
          email: members[0].user.email,
        },
        history: [],
      };
      supportRequests.unshift(item);
      return json(route, {
        request: item,
        created: true,
        telegramDelivered: true,
        telegramMessageId: item.telegramMessageId,
      });
    }
    if (path === `/api/v1/workspaces/${workspace.id}/site-audits`) {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { url: string };
        const audit = mockSiteAudit(`audit-${siteAudits.length + 1}`, body.url);
        siteAudits.unshift(audit);
        return json(route, audit);
      }
      return json(route, { items: siteAudits });
    }
    if (path.startsWith(`/api/v1/workspaces/${workspace.id}/site-audits/`)) {
      const tail = path.slice(
        `/api/v1/workspaces/${workspace.id}/site-audits/`.length,
      );
      const [auditId, resource] = tail.split("/");
      const audit =
        siteAudits.find((item) => item.id === auditId) ??
        mockSiteAudit(auditId || "audit-1", "https://example.com");
      if (resource === "screenshot")
        return route.fulfill({
          status: 200,
          headers: { ...cors, "content-type": "image/png" },
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0l" +
              "EQVR42mP8/x8AAusB9Wl6x4YAAAAASUVORK5CYII=",
            "base64",
          ),
        });
      if (resource === "report.docx")
        return route.fulfill({
          status: 200,
          headers: {
            ...cors,
            "content-type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
          body: "mock-docx",
        });
      return json(route, audit);
    }
    if (
      path === `/api/v1/workspaces/${workspace.id}/billing/tariff-requests` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as { planKey?: string };
      const existing = tariffRequests.find(
        (item) =>
          item.requestedPlanKey === body.planKey && item.status === "PENDING",
      );
      if (existing) return json(route, { request: existing, created: false });
      const item = {
        id: `tariff-request-${tariffRequests.length + 1}`,
        requestedPlanKey: body.planKey,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      tariffRequests.push(item);
      return json(route, { request: item, created: true });
    }
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
          ["GOOGLE_ANALYTICS", "Google Analytics"],
        ].map(([id, displayName]) => ({
          id,
          displayName,
          status: "AVAILABLE",
          oauth: true,
        })),
      );
    if (path.endsWith("/oauth/start") && request.method() === "POST")
      return json(route, {
        authorizationUrl: "https://oauth.example.test/authorize",
      });
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
        {
          id: "88888888-8888-4888-8888-888888888888",
          provider: "GOOGLE_ANALYTICS",
          displayName: "HolyMedia Analytics",
          status: "CONNECTED",
          accounts: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              externalAccountId: "987654321",
              displayName: "HolyMedia GA4",
              enabled: true,
              status: "CONNECTED",
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
      return json(
        route,
        tokens.filter((token) => !token.revokedAt),
      );
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
