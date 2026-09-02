"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { SiteFooter } from "../../components/site-footer";
import { LanguageSwitcher } from "../../components/language-switcher";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const MCP_URL = "https://mcp.holymedia.kz/mcp";

type Workspace = { id: string; name: string; slug: string; role: string };
type Provider = {
  id: string;
  displayName: string;
  status: string;
  oauth: boolean;
};
type ProviderAccount = {
  id: string;
  externalAccountId: string;
  displayName: string;
  enabled: boolean;
  status: string | null;
};
type Connection = {
  id: string;
  provider: string;
  displayName: string | null;
  status: string;
  accounts: ProviderAccount[];
};
type ServiceToken = {
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
type Profile = { name: string; email: string };
type Section =
  "overview" | "connections" | "mcp" | "reports" | "analysis" | "profile";
type Client = "codex" | "claude" | "chatgpt";
type ReportFormat = "docx" | "pptx";
type ReportMetric = {
  amount?: string;
  currency?: string;
} | null;
type ReportPreview = {
  period: { startDate: string; endDate: string };
  account: {
    provider: string;
    externalAccountId: string;
    name: string;
    currency: string | null;
  };
  metrics: {
    spend: ReportMetric;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    conversions: number | null;
    costPerConversion: ReportMetric;
  };
  campaigns: Array<{
    id: string;
    name: string;
    status: string | null;
    metrics?: {
      spend?: ReportMetric;
      clicks?: number | null;
      conversions?: number | null;
    };
  }>;
  insights: string[];
  provenance: {
    summary: { sourceApi: string; realData: boolean; dataStatus: string };
  };
};
type AnalysisMode = "quick" | "full";
type AnalysisBrief = {
  siteType: string;
  goal: string;
  audience: string;
  region: string;
  competitor: string;
  concern: string;
};
type AnalysisItem = {
  priority?: string;
  title?: string;
  problem?: string;
  evidence?: string;
  recommendation?: string;
};
type SiteAnalysis = {
  id: string;
  url: string;
  result: {
    status?: number;
    title?: string | null;
    description?: string | null;
    h1Count?: number;
    h2Count?: number;
    linkCount?: number;
    imageCount?: number;
    formCount?: number;
    scores?: Array<{
      id: string;
      label: string;
      value: number;
      description: string;
    }>;
    overview?: { verdict?: string; mainRisk?: string; quickWin?: string };
    topIssues?: AnalysisItem[];
    quickWins?: Array<{ title?: string }>;
    hero?: { h1?: string; subtitle?: string; cta?: string };
    structure?: string[];
    oneDayPlan?: Array<{ step?: number; title?: string }>;
    questions?: string[];
    evidence?: { limitations?: string };
    checks?: {
      https?: boolean;
      hasTitle?: boolean;
      hasDescription?: boolean;
      hasSingleH1?: boolean;
    };
  };
  created_at: string;
};
type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
};

const PROVIDER_COPY: Record<
  string,
  { name: string; description: string; short: string }
> = {
  GOOGLE_ADS: {
    name: "Google Ads",
    short: "G",
    description: "Кампании, расходы, клики и конверсии.",
  },
  META_ADS: {
    name: "Meta Ads",
    short: "M",
    description: "Facebook, Instagram, кампании и результаты.",
  },
  YANDEX_DIRECT: {
    name: "Яндекс Директ",
    short: "Я",
    description: "Клиенты и рекламные кабинеты Директа.",
  },
  TIKTOK_ADS: {
    name: "TikTok Ads",
    short: "T",
    description: "Доступные рекламные аккаунты TikTok.",
  },
  GOOGLE_SEARCH_CONSOLE: {
    name: "Google Search Console",
    short: "S",
    description: "Данные поиска и страницы сайта.",
  },
};

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Не удалось подтвердить сессию.");
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

function dateRange(days: number) {
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function formatReportNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Нет данных"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
        value,
      );
}

function formatReportMoney(value: ReportMetric): string {
  if (!value?.amount) return "Нет данных";
  return `${formatReportNumber(Number(value.amount))} ${value.currency ?? ""}`.trim();
}

function providerCopy(provider: string) {
  return (
    PROVIDER_COPY[provider] ?? {
      name: provider,
      short: provider.charAt(0),
      description: "Рекламная платформа.",
    }
  );
}

function connectionStatus(status: string) {
  if (status === "CONNECTED") return { label: "Подключено", tone: "ok" };
  if (status === "DEGRADED") return { label: "Нужно проверить", tone: "warn" };
  if (status === "REAUTH_REQUIRED")
    return { label: "Нужно войти снова", tone: "warn" };
  if (status === "ERROR") return { label: "Ошибка подключения", tone: "err" };
  return { label: "Не подключено", tone: "info" };
}

function oauthFailureMessage(provider: string | null, reason: string | null) {
  const name = providerCopy(provider ?? "").name;
  if (reason === "insufficient_permissions") {
    if (provider === "META_ADS")
      return "Meta не выдала нужные разрешения. Проверьте, что pages_read_engagement и ads_read одобрены для приложения, а ваш аккаунт добавлен в роли приложения.";
    if (provider === "TIKTOK_ADS")
      return "TikTok не выдал запрошенные разрешения. Проверьте одобрение приложения и права пользователя в TikTok Business Center.";
    return `${name} не выдала запрошенные разрешения. Проверьте настройки приложения и права пользователя.`;
  }
  if (reason === "authorization_denied")
    return `Авторизация ${name} отменена. Разрешите доступ и попробуйте ещё раз.`;
  if (reason === "provider_not_configured")
    return `${name} пока не настроена на сервере. Обратитесь к оператору.`;
  if (reason === "invalid_callback")
    return `${name} вернула неполный ответ авторизации. Запустите подключение заново.`;
  if (reason === "authentication_failed")
    return `${name} не подтвердила авторизацию. Проверьте аккаунт и повторите вход.`;
  return `Подключение ${name} не завершено. Проверьте настройки приложения и попробуйте ещё раз.`;
}

async function responseErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return payload.error?.message || payload.message || fallback;
  } catch {
    return fallback;
  }
}

export default function DashboardPage() {
  const [active, setActive] = useState<Workspace | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tokens, setTokens] = useState<ServiceToken[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [client, setClient] = useState<Client>("codex");
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [openAccountsId, setOpenAccountsId] = useState<string | null>(null);
  const [highlightedProvider, setHighlightedProvider] = useState<string | null>(
    null,
  );
  const [savingAccounts, setSavingAccounts] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState("");
  const [reportDays, setReportDays] = useState(7);
  const [reportAccountId, setReportAccountId] = useState("");
  const [reportPreview, setReportPreview] = useState<ReportPreview | null>(
    null,
  );
  const [reportPreviewBusy, setReportPreviewBusy] = useState(false);
  const [reportPreviewError, setReportPreviewError] = useState("");
  const [analysisUrl, setAnalysisUrl] = useState("");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("quick");
  const [analysisBrief, setAnalysisBrief] = useState<AnalysisBrief>({
    siteType: "",
    goal: "",
    audience: "",
    region: "",
    competitor: "",
    concern: "",
  });
  const [analysisTab, setAnalysisTab] = useState<
    "priorities" | "hero" | "plan" | "details"
  >("priorities");
  const [analysisStage, setAnalysisStage] = useState(0);
  const [analysisHistory, setAnalysisHistory] = useState<SiteAnalysis[]>([]);
  const [analysisResult, setAnalysisResult] = useState<SiteAnalysis | null>(
    null,
  );
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingProvider, setStartingProvider] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  const canManage = Boolean(active && ["OWNER", "ADMIN"].includes(active.role));
  const enabledAccounts = useMemo(
    () =>
      connections.flatMap((connection) =>
        ["CONNECTED", "DEGRADED", "REAUTH_REQUIRED"].includes(connection.status)
          ? connection.accounts
              .filter((account) => account.enabled)
              .map((account) => ({ account, connection }))
          : [],
      ),
    [connections],
  );
  const reportableAccounts = useMemo(
    () =>
      enabledAccounts.filter(
        ({ connection }) =>
          connection.status === "CONNECTED" &&
          ["META_ADS", "GOOGLE_ADS"].includes(connection.provider),
      ),
    [enabledAccounts],
  );
  const connectedCount = connections.filter((connection) =>
    ["CONNECTED", "DEGRADED", "REAUTH_REQUIRED"].includes(connection.status),
  ).length;

  function notify(text: string) {
    setError("");
    setMessage(text);
  }

  function fail(text: string) {
    setMessage("");
    setError(text);
  }

  async function loadWorkspaces() {
    const response = await fetch(`${API}/api/v1/workspaces`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      window.location.assign("/auth");
      return;
    }
    const data = (await response.json()) as Workspace[];
    setActive((current) =>
      current && data.some((item) => item.id === current.id)
        ? current
        : (data[0] ?? null),
    );
  }

  async function loadProfile() {
    const [profileResponse, avatarResponse] = await Promise.all([
      fetch(`${API}/api/profile`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${API}/api/profile/avatar`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (profileResponse.ok) {
      const data = (await profileResponse.json()) as { profile: Profile };
      setProfile(data.profile);
      setProfileName(data.profile.name);
    }
    if (avatarResponse.ok) {
      const data = (await avatarResponse.json()) as { dataUrl: string | null };
      setAvatar(data.dataUrl);
    }
  }

  async function loadConnections(workspace: Workspace) {
    const [providerResponse, connectionResponse] = await Promise.all([
      fetch(`${API}/api/v1/providers`, { credentials: "include" }),
      fetch(`${API}/api/v1/workspaces/${workspace.id}/connections`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (providerResponse.ok)
      setProviders((await providerResponse.json()) as Provider[]);
    if (connectionResponse.ok) {
      const data = (await connectionResponse.json()) as Connection[];
      setConnections(data);
      setDrafts(
        Object.fromEntries(
          data.map((connection) => [
            connection.id,
            connection.accounts
              .filter((account) => account.enabled)
              .map((account) => account.id),
          ]),
        ),
      );
      if (highlightedProvider) {
        const matching = data.find(
          (connection) => connection.provider === highlightedProvider,
        );
        if (matching) setOpenAccountsId(matching.id);
      }
    }
  }

  async function loadTokens(workspace: Workspace) {
    if (!["OWNER", "ADMIN"].includes(workspace.role)) {
      setTokens([]);
      return;
    }
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/service-tokens`,
      { credentials: "include", cache: "no-store" },
    );
    if (response.ok) setTokens((await response.json()) as ServiceToken[]);
  }

  useEffect(() => {
    void loadWorkspaces();
    void loadProfile();
    const query = new URLSearchParams(window.location.search);
    const requestedSection = query.get("section");
    if (
      requestedSection === "connections" ||
      requestedSection === "mcp" ||
      requestedSection === "reports" ||
      requestedSection === "analysis" ||
      requestedSection === "profile"
    )
      setSection(requestedSection);
    const oauthProvider = query.get("provider")?.toUpperCase();
    const oauthProviderAliases: Record<string, string> = {
      GOOGLE: "GOOGLE_ADS",
      META: "META_ADS",
      YANDEX: "YANDEX_DIRECT",
      TIKTOK: "TIKTOK_ADS",
    };
    if (oauthProvider)
      setHighlightedProvider(
        oauthProviderAliases[oauthProvider] ?? oauthProvider,
      );
    setStartingProvider(null);
    setBusy(false);
    if (query.get("oauth") === "success")
      notify(
        "Платформа подключена. Откройте список кабинетов и выберите нужные.",
      );
    if (query.get("oauth") === "error")
      fail(
        oauthFailureMessage(
          oauthProviderAliases[oauthProvider ?? ""] ?? oauthProvider ?? null,
          query.get("oauth_reason"),
        ),
      );
    if (query.has("oauth"))
      window.history.replaceState({}, "", "/dashboard?section=connections");
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadConnections(active);
    void loadTokens(active);
  }, [active]);

  useEffect(() => {
    if (section === "analysis" && active) void loadAnalysisHistory();
  }, [active, section]);

  useEffect(() => {
    const first = reportableAccounts[0]?.account.id ?? "";
    if (
      !reportableAccounts.some(({ account }) => account.id === reportAccountId)
    ) {
      setReportAccountId(first);
    }
  }, [reportableAccounts, reportAccountId]);

  useEffect(() => {
    if (section !== "reports" || !active || !reportAccountId) {
      setReportPreview(null);
      setReportPreviewError("");
      return;
    }
    void loadReportPreview(active.id, reportAccountId, reportDays);
  }, [active, reportAccountId, reportDays, section]);

  useEffect(() => {
    if (!highlightedProvider) return;
    document
      .getElementById(`provider-${highlightedProvider}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [connections, highlightedProvider]);

  useEffect(() => {
    if (!confirm) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirm(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [confirm]);

  async function startProvider(provider: string) {
    if (!active || provider === "GOOGLE_SEARCH_CONSOLE") return;
    setStartingProvider(provider);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${provider}/oauth/start`,
        {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": await csrf() },
        },
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { authorizationUrl: string };
      window.location.assign(data.authorizationUrl);
    } catch {
      fail(
        "Не удалось открыть вход в рекламную платформу. Попробуйте ещё раз.",
      );
    } finally {
      setStartingProvider(null);
    }
  }

  async function discover(connection: Connection) {
    if (!active) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}/accounts/discover`,
        {
          method: "POST",
          credentials: "include",
          headers: { "x-csrf-token": await csrf() },
        },
      );
      if (!response.ok) throw new Error();
      await loadConnections(active);
      notify("Список кабинетов обновлён.");
    } catch {
      fail("Не удалось обновить список кабинетов.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(connection: Connection) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    if (!response.ok) {
      fail("Не удалось отключить платформу.");
      return;
    }
    setOpenAccountsId((current) =>
      current === connection.id ? null : current,
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[connection.id];
      return next;
    });
    await loadConnections(active);
    notify(`${providerCopy(connection.provider).name} отключён.`);
  }

  function toggleDraft(connectionId: string, accountId: string) {
    setDrafts((current) => {
      const selected = new Set(current[connectionId] ?? []);
      if (selected.has(accountId)) selected.delete(accountId);
      else selected.add(accountId);
      return { ...current, [connectionId]: [...selected] };
    });
  }

  async function saveAccounts(connection: Connection) {
    if (!active) return;
    const selected = new Set(drafts[connection.id] ?? []);
    const changes = connection.accounts.filter(
      (account) => account.enabled !== selected.has(account.id),
    );
    if (!changes.length) {
      notify("Выбор уже сохранён.");
      return;
    }
    setSavingAccounts(connection.id);
    try {
      const csrfToken = await csrf();
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}/accounts`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ enabledAccountIds: [...selected] }),
        },
      );
      if (!response.ok)
        throw new Error(
          await responseErrorMessage(
            response,
            "Не удалось сохранить выбор кабинетов.",
          ),
        );
      await loadConnections(active);
      notify("Выбранные кабинеты сохранены.");
    } catch (cause) {
      await loadConnections(active);
      fail(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить выбор кабинетов.",
      );
    } finally {
      setSavingAccounts(null);
    }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const accountIds = enabledAccounts.map(({ account }) => account.id);
    if (!accountIds.length) {
      fail("Сначала выберите кабинеты в разделе «Подключения».");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/service-tokens`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({
            name: form.get("name"),
            scopes: form.get("write")
              ? ["adforge:mcp:read", "adforge:mcp:write"]
              : ["adforge:mcp:read"],
            accountIds,
            expiresInDays: Number(form.get("expires_in_days") || 90),
          }),
        },
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as ServiceToken & { token: string };
      setCreatedToken(data.token);
      formElement.reset();
      await loadTokens(active);
      notify("Ключ создан. Сохраните его сейчас.");
    } catch {
      fail("Не удалось создать ключ.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(token: ServiceToken) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/service-tokens/${token.id}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    if (!response.ok) return fail("Не удалось отозвать ключ.");
    await loadTokens(active);
    notify("Ключ отозван.");
  }

  async function rotateToken(token: ServiceToken) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/service-tokens/${token.id}/rotate`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: "{}",
      },
    );
    if (!response.ok) return fail("Не удалось обновить ключ.");
    const data = (await response.json()) as ServiceToken & { token: string };
    setCreatedToken(data.token);
    await loadTokens(active);
    notify("Новый ключ готов. Сохраните его сейчас.");
  }

  async function grantConfirmedWrite(token: ServiceToken) {
    if (!active) return;
    if (token.accountIds.length !== 1) {
      fail(
        "Для подтверждённой записи ключ должен быть ограничен одним рекламным кабинетом.",
      );
      return;
    }
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/service-tokens/${token.id}/scopes`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({
          scopes: ["adforge:mcp:read", "adforge:mcp:write"],
        }),
      },
    );
    if (!response.ok) {
      return fail(
        await responseErrorMessage(
          response,
          "Не удалось выдать ключу право подтверждённой записи.",
        ),
      );
    }
    await loadTokens(active);
    notify("Ключ получил право подтверждённой записи для своего кабинета.");
  }

  async function loadReportPreview(
    workspaceId: string,
    accountId: string,
    days: number,
  ) {
    setReportPreviewBusy(true);
    setReportPreviewError("");
    try {
      const query = new URLSearchParams({ accountId, ...dateRange(days) });
      const response = await fetch(
        `${API}/api/v1/workspaces/${workspaceId}/reports/performance?${query}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: "Для отчёта нужен выбранный кабинет Meta Ads или Google Ads.",
          401: "Сессия закончилась. Войдите ещё раз.",
          403: "Отчёты недоступны для этого кабинета или тарифа.",
          404: "Кабинет больше недоступен. Обновите подключения.",
          429: "Слишком много запросов. Повторите попытку через минуту.",
          503: "Рекламная платформа временно не ответила.",
        };
        throw new Error(
          messages[response.status] ?? "Не удалось получить данные отчёта.",
        );
      }
      setReportPreview((await response.json()) as ReportPreview);
    } catch (cause) {
      setReportPreview(null);
      setReportPreviewError(
        cause instanceof Error
          ? cause.message
          : "Не удалось получить данные отчёта.",
      );
    } finally {
      setReportPreviewBusy(false);
    }
  }

  async function downloadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("account_id") ?? reportAccountId);
    const requestedFormat = String(form.get("format") ?? "docx");
    const format: ReportFormat = requestedFormat === "pptx" ? "pptx" : "docx";
    if (!accountId) return;
    setBusy(true);
    try {
      const query = new URLSearchParams({
        accountId,
        ...dateRange(reportDays),
      });
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/reports/performance.${format}?${query}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: "Для отчёта выберите кабинет Meta Ads или Google Ads.",
          401: "Сессия закончилась. Войдите ещё раз.",
          403: "Для этого кабинета отчёты пока недоступны.",
          404: "Кабинет больше недоступен. Обновите список подключений.",
          429: "Слишком много запросов. Подождите немного и повторите попытку.",
          503: "Платформа временно не ответила. Попробуйте ещё раз или проверьте подключение.",
        };
        throw new Error(
          messages[response.status] ??
            "Не удалось собрать отчёт. Попробуйте ещё раз.",
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `holymedia-performance-report.${format}`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
      }, 1000);
      notify(format === "pptx" ? "Презентация готова." : "Отчёт готов.");
    } catch (cause) {
      fail(
        cause instanceof Error
          ? cause.message
          : "Не удалось собрать отчёт. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadAnalysisHistory(): Promise<SiteAnalysis[]> {
    const response = await fetch(`${API}/api/site/history`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { items: SiteAnalysis[] };
    setAnalysisHistory(data.items);
    return data.items;
  }

  async function analyzeSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !analysisUrl.trim()) return;
    setAnalysisBusy(true);
    setAnalysisStage(0);
    setError("");
    setMessage("");
    let progressTimer: number | undefined;
    try {
      progressTimer = window.setTimeout(() => setAnalysisStage(1), 650);
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/site-analysis`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({
            url: analysisUrl.trim(),
            mode: analysisMode,
            ...analysisBrief,
          }),
        },
      );
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok)
        throw new Error(data.error?.message ?? "Не удалось проверить сайт.");
      const items = await loadAnalysisHistory();
      setAnalysisResult(items[0] ?? null);
      notify("Проверка сайта завершена.");
    } catch (requestError) {
      fail(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось проверить сайт.",
      );
    } finally {
      if (progressTimer) window.clearTimeout(progressTimer);
      setAnalysisBusy(false);
      setAnalysisStage(0);
    }
  }

  async function downloadSiteAnalysis(item: SiteAnalysis) {
    try {
      const response = await fetch(`${API}/api/site/report.docx`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ history_id: item.id }),
      });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "holymedia-site-analysis.docx";
      link.click();
      URL.revokeObjectURL(url);
      notify("Отчёт анализа скачан.");
    } catch {
      fail("Не удалось скачать отчёт анализа.");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(`${API}/api/profile`, {
      method: "PUT",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({ name: profileName }),
    });
    if (!response.ok) return fail("Не удалось сохранить имя.");
    const data = (await response.json()) as { profile: Profile };
    setProfile(data.profile);
    notify("Профиль сохранён.");
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return fail("Выберите изображение JPG, PNG или WebP.");
    if (file.size > 2_097_152)
      return fail("Размер изображения не должен превышать 2 МБ.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error());
      reader.readAsDataURL(file);
    });
    const response = await fetch(`${API}/api/profile/avatar`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({ dataUrl }),
    });
    if (!response.ok) return fail("Не удалось обновить фото.");
    setAvatar(((await response.json()) as { dataUrl: string }).dataUrl);
    notify("Фото профиля обновлено.");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`${API}/api/v1/auth/password/change`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({
        currentPassword: form.get("current_password"),
        newPassword: form.get("new_password"),
      }),
    });
    if (!response.ok)
      return fail("Не удалось изменить пароль. Проверьте текущий пароль.");
    formElement.reset();
    notify("Пароль изменён.");
  }

  async function copy(text: string, success: string) {
    await navigator.clipboard.writeText(text);
    notify(success);
  }

  async function logout() {
    await fetch(`${API}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": await csrf() },
    });
    window.location.assign("/auth");
  }

  const nav: Array<{ id?: Section; label: string; disabled?: boolean }> = [
    { id: "overview", label: "Обзор" },
    { id: "connections", label: "Подключения" },
    { id: "mcp", label: "AI-клиент" },
    { id: "reports", label: "Отчёты" },
    { id: "analysis", label: "Анализ сайта" },
    { label: "SEO", disabled: true },
    { label: "Тарифы", disabled: true },
  ];
  const allProviderIds = [
    "GOOGLE_ADS",
    "META_ADS",
    "YANDEX_DIRECT",
    "TIKTOK_ADS",
  ];

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-topbar">
          <a
            className="brand-link"
            href="/dashboard"
            aria-label="HolyMedia MCP — обзор"
          >
            <span className="logo-dot" aria-hidden="true" />
            <span>HolyMedia MCP</span>
          </a>
          <div className="dashboard-actions">
            <LanguageSwitcher compact />
            <button
              className="profile-link"
              type="button"
              aria-label={`Открыть профиль${profile?.email ? `: ${profile.email}` : ""}`}
              onClick={() => setSection("profile")}
            >
              {avatar ? (
                <img src={avatar} alt="" />
              ) : (
                <span aria-hidden="true">
                  {profile?.name?.charAt(0).toUpperCase() || "H"}
                </span>
              )}
              <strong>{profile?.email ?? "Профиль"}</strong>
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void logout()}
            >
              Выйти
            </button>
          </div>
        </div>
        <nav className="tabs-bar" aria-label="Основные разделы">
          {nav.map((item) => (
            <button
              key={item.label}
              className={item.id === section ? "nav-tab is-active" : "nav-tab"}
              type="button"
              disabled={item.disabled}
              title={item.disabled ? "Скоро" : undefined}
              onClick={() => item.id && setSection(item.id)}
            >
              {item.label}
              {item.disabled && <small>Скоро</small>}
            </button>
          ))}
        </nav>
      </header>

      <div className="dashboard-main">
        {(message || error) && (
          <div
            className={
              error ? "notice notice--error" : "notice notice--success"
            }
            role={error ? "alert" : "status"}
          >
            <span>{error || message}</span>
            <button
              type="button"
              aria-label="Закрыть сообщение"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              ×
            </button>
          </div>
        )}

        {section === "overview" && (
          <section className="section" aria-labelledby="overview-title">
            <div className="overview-hero">
              <div className="overview-lead">
                <p className="eyebrow">Личный кабинет</p>
                <h1 id="overview-title">Реклама в вашем AI-чате</h1>
                <p>
                  Подключите рекламные платформы, выберите кабинеты и задавайте
                  вопросы о кампаниях обычными словами.
                </p>
                <div className="overview-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setSection("connections")}
                  >
                    Подключить платформу
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setSection("mcp")}
                  >
                    Подключить AI-клиент
                  </button>
                </div>
              </div>
              <div className="overview-stats">
                <div className="stat-card">
                  <span>Платформы</span>
                  <strong>{connectedCount}</strong>
                  <small>подключено</small>
                </div>
                <div className="stat-card">
                  <span>Кабинеты</span>
                  <strong>{enabledAccounts.length}</strong>
                  <small>выбрано</small>
                </div>
                <div className="stat-card">
                  <span>AI-клиент</span>
                  <strong>
                    {tokens.some((token) => !token.revokedAt) ? "Готов" : "—"}
                  </strong>
                  <small>ключ доступа</small>
                </div>
                <div className="stat-card">
                  <span>Отчёты</span>
                  <strong>DOCX</strong>
                  <small>за выбранный период</small>
                </div>
              </div>
            </div>
            <ol className="onboarding-steps" aria-label="Как начать">
              <li className="onboarding-step">
                <span className="onboarding-step__num">1</span>
                <strong>Подключите платформу</strong>
                <p>Войдите через официальный OAuth.</p>
              </li>
              <li className="onboarding-step">
                <span className="onboarding-step__num">2</span>
                <strong>Выберите кабинеты</strong>
                <p>Отметьте аккаунты, с которыми хотите работать.</p>
              </li>
              <li className="onboarding-step">
                <span className="onboarding-step__num">3</span>
                <strong>Добавьте AI-клиент</strong>
                <p>Скопируйте MCP URL и следуйте инструкции.</p>
              </li>
            </ol>
          </section>
        )}

        {section === "connections" && (
          <section className="section" aria-labelledby="connections-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Рекламные платформы</p>
                <h1 id="connections-title">Подключения</h1>
                <p className="section-head__sub">
                  Подключите платформу и выберите кабинеты для AI-клиента.
                </p>
              </div>
            </div>
            <div className="connection-list">
              {allProviderIds.map((providerId) => {
                const definition = providers.find(
                  (item) => item.id === providerId,
                );
                const storedConnection = connections.find(
                  (item) => item.provider === providerId,
                );
                const connection =
                  storedConnection &&
                  !["DISCONNECTED", "REVOKED"].includes(storedConnection.status)
                    ? storedConnection
                    : undefined;
                const copyText = providerCopy(providerId);
                const status = connectionStatus(connection?.status ?? "");
                const selected = new Set(
                  connection ? (drafts[connection.id] ?? []) : [],
                );
                const accountsOpen = connection
                  ? openAccountsId === connection.id
                  : false;
                return (
                  <article
                    className={`connection-card ${
                      highlightedProvider === providerId ? "is-highlighted" : ""
                    }`}
                    id={`provider-${providerId}`}
                    key={providerId}
                  >
                    <div className="connection-card__head">
                      <span
                        className={`provider-mark provider-mark--${providerId.toLowerCase()}`}
                        aria-hidden="true"
                      >
                        {copyText.short}
                      </span>
                      <div>
                        <h2>{copyText.name}</h2>
                        <p>{copyText.description}</p>
                      </div>
                      <span className={`status-badge ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    {connection ? (
                      <>
                        <p className="connection-count">
                          {connection.accounts.length
                            ? `${connection.accounts.length} кабинетов · ${selected.size} выбрано`
                            : "Кабинеты ещё не найдены"}
                        </p>
                        {connection.status !== "CONNECTED" && (
                          <p className="connection-note">
                            Подключите платформу заново, чтобы восстановить
                            доступ к кабинетам.
                          </p>
                        )}
                        <div className="connection-actions">
                          <button
                            className="primary-button btn--small"
                            type="button"
                            aria-expanded={accountsOpen}
                            aria-controls={`accounts-${connection.id}`}
                            onClick={() =>
                              setOpenAccountsId(
                                accountsOpen ? null : connection.id,
                              )
                            }
                          >
                            {accountsOpen
                              ? "Скрыть кабинеты"
                              : "Посмотреть кабинеты"}
                          </button>
                          <button
                            className="secondary-button btn--small"
                            type="button"
                            disabled={busy}
                            onClick={() => void discover(connection)}
                          >
                            Обновить
                          </button>
                          {connection.status !== "CONNECTED" && (
                            <button
                              className="ghost-button btn--small"
                              type="button"
                              disabled={startingProvider !== null}
                              onClick={() => void startProvider(providerId)}
                            >
                              Подключить заново
                            </button>
                          )}
                        </div>
                        <button
                          className="danger-link connection-disconnect"
                          type="button"
                          onClick={() =>
                            setConfirm({
                              title: `Отключить ${copyText.name}?`,
                              description:
                                "Кабинеты этой платформы перестанут быть доступны в AI-клиенте. Чтобы вернуть доступ, потребуется подключить её снова.",
                              confirmLabel: "Отключить",
                              run: () => disconnect(connection),
                            })
                          }
                        >
                          Отключить
                        </button>
                        {accountsOpen && (
                          <div
                            className="account-selector"
                            id={`accounts-${connection.id}`}
                          >
                            <div className="account-selector__head">
                              <div>
                                <h3>Выберите кабинеты</h3>
                                <p>
                                  {selected.size} из{" "}
                                  {connection.accounts.length}
                                </p>
                              </div>
                              {connection.accounts.length > 0 && (
                                <div className="bulk-actions">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDrafts((current) => ({
                                        ...current,
                                        [connection.id]:
                                          connection.accounts.map(
                                            (account) => account.id,
                                          ),
                                      }))
                                    }
                                  >
                                    Выбрать все
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDrafts((current) => ({
                                        ...current,
                                        [connection.id]: [],
                                      }))
                                    }
                                  >
                                    Снять все
                                  </button>
                                </div>
                              )}
                            </div>
                            {connection.accounts.length ? (
                              <div className="account-list">
                                {connection.accounts.map((account) => (
                                  <label
                                    className="account-row"
                                    key={account.id}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected.has(account.id)}
                                      onChange={() =>
                                        toggleDraft(connection.id, account.id)
                                      }
                                    />
                                    <span>
                                      <strong>{account.displayName}</strong>
                                      <small>
                                        {account.status === "ENABLED" ||
                                        !account.status
                                          ? "Доступен"
                                          : "Проверьте статус в платформе"}
                                      </small>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <div className="empty-state">
                                <p>Кабинеты пока не найдены.</p>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => void discover(connection)}
                                >
                                  Найти кабинеты
                                </button>
                              </div>
                            )}
                            {connection.accounts.length > 0 && (
                              <div className="account-selector__save">
                                <button
                                  className="primary-button"
                                  type="button"
                                  disabled={savingAccounts === connection.id}
                                  onClick={() => void saveAccounts(connection)}
                                >
                                  {savingAccounts === connection.id
                                    ? "Сохраняем…"
                                    : "Сохранить выбор"}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="connection-empty">
                        <p>Платформа ещё не подключена.</p>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={
                            startingProvider !== null ||
                            definition?.status === "DISABLED"
                          }
                          onClick={() => void startProvider(providerId)}
                        >
                          Подключить {copyText.name}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <details className="support-details">
              <summary>Нужна помощь с подключением Meta?</summary>
              <p>
                Напишите на{" "}
                <a href="mailto:mcp@holymedia.kz">mcp@holymedia.kz</a>.
                Специалист поможет, не получая лишнего доступа к вашему
                аккаунту.
              </p>
            </details>
          </section>
        )}

        {section === "mcp" && (
          <section className="section" aria-labelledby="mcp-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">AI-клиент</p>
                <h1 id="mcp-title">Подключите HolyMedia MCP</h1>
                <p className="section-head__sub">
                  Скопируйте адрес, создайте личный ключ и выберите инструкцию.
                </p>
              </div>
            </div>
            <section className="mcp-setup">
              <div className="mcp-step">
                <span>1</span>
                <div>
                  <h2>Скопируйте MCP URL</h2>
                  <div className="copy-row">
                    <code>{MCP_URL}</code>
                    <button
                      className="secondary-button btn--small"
                      type="button"
                      onClick={() => void copy(MCP_URL, "MCP URL скопирован.")}
                    >
                      Скопировать
                    </button>
                  </div>
                </div>
              </div>
              <div className="mcp-step">
                <span>2</span>
                <div className="mcp-step__body">
                  <h2>Создайте ключ доступа</h2>
                  {canManage ? (
                    <form className="token-form" onSubmit={createToken}>
                      <div className="form-row">
                        <label>
                          Название
                          <input
                            name="name"
                            required
                            minLength={2}
                            placeholder="Например, Codex"
                          />
                        </label>
                        <label>
                          Срок действия
                          <select name="expires_in_days" defaultValue="90">
                            <option value="30">30 дней</option>
                            <option value="90">90 дней</option>
                            <option value="365">1 год</option>
                          </select>
                        </label>
                      </div>
                      <p className="scope-note">
                        Ключ получит доступ к {enabledAccounts.length} выбранным
                        кабинетам из раздела «Подключения».
                      </p>
                      <details className="advanced-settings">
                        <summary>Дополнительные настройки</summary>
                        <label className="check-row">
                          <input type="checkbox" name="write" />
                          <span>Разрешить подтверждённые изменения</span>
                          <small>
                            Любое изменение потребует предварительного просмотра
                            и подтверждения.
                          </small>
                        </label>
                      </details>
                      <button
                        className="primary-button"
                        type="submit"
                        disabled={busy || !enabledAccounts.length}
                      >
                        Создать ключ
                      </button>
                    </form>
                  ) : (
                    <div className="empty-state">
                      <p>
                        Создать ключ может владелец аккаунта. Попросите его
                        выдать вам доступ.
                      </p>
                    </div>
                  )}
                  {createdToken && (
                    <div className="one-time-secret" role="status">
                      <strong>Сохраните ключ сейчас</strong>
                      <p>
                        После закрытия страницы полный ключ больше не
                        показывается.
                      </p>
                      <div className="copy-row">
                        <code>{createdToken}</code>
                        <button
                          className="secondary-button btn--small"
                          type="button"
                          onClick={() =>
                            void copy(createdToken, "Ключ скопирован.")
                          }
                        >
                          Скопировать
                        </button>
                      </div>
                      <button
                        className="ghost-button btn--small"
                        type="button"
                        onClick={() => setCreatedToken("")}
                      >
                        Скрыть
                      </button>
                    </div>
                  )}
                  {canManage && tokens.length > 0 && (
                    <div className="token-list">
                      <h3>Ваши ключи</h3>
                      {tokens.map((token) => (
                        <div className="token-row" key={token.id}>
                          <span>
                            <strong>{token.name}</strong>
                            <small>
                              {token.revokedAt
                                ? "Отозван"
                                : token.expiresAt
                                  ? `Действует до ${new Date(token.expiresAt).toLocaleDateString("ru-RU")}`
                                  : "Без срока"}
                            </small>
                          </span>
                          {!token.revokedAt && (
                            <div>
                              {!token.scopes.includes("adforge:mcp:write") && (
                                <button
                                  className="ghost-button btn--small"
                                  type="button"
                                  onClick={() =>
                                    setConfirm({
                                      title: `Разрешить подтверждённую запись для «${token.name}»?`,
                                      description:
                                        "Значение ключа не изменится. Сервер разрешит только allowlisted Meta-операцию после отдельного подтверждения.",
                                      confirmLabel: "Разрешить",
                                      run: () => grantConfirmedWrite(token),
                                    })
                                  }
                                >
                                  Разрешить запись
                                </button>
                              )}
                              <button
                                className="ghost-button btn--small"
                                type="button"
                                onClick={() =>
                                  setConfirm({
                                    title: `Обновить ключ «${token.name}»?`,
                                    description:
                                      "Старое значение сразу перестанет работать.",
                                    confirmLabel: "Обновить",
                                    run: () => rotateToken(token),
                                  })
                                }
                              >
                                Обновить
                              </button>
                              <button
                                className="danger-link"
                                type="button"
                                onClick={() =>
                                  setConfirm({
                                    title: `Отозвать ключ «${token.name}»?`,
                                    description:
                                      "AI-клиент с этим ключом потеряет доступ.",
                                    confirmLabel: "Отозвать",
                                    run: () => revokeToken(token),
                                  })
                                }
                              >
                                Отозвать
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="mcp-step">
                <span>3</span>
                <div className="mcp-step__body">
                  <h2>Выберите AI-клиент</h2>
                  <div
                    className="client-tabs"
                    role="tablist"
                    aria-label="AI-клиенты"
                  >
                    {(["codex", "claude", "chatgpt"] as Client[]).map(
                      (item) => (
                        <button
                          key={item}
                          type="button"
                          role="tab"
                          aria-selected={client === item}
                          className={client === item ? "is-active" : ""}
                          onClick={() => setClient(item)}
                        >
                          {item === "codex"
                            ? "Codex"
                            : item === "claude"
                              ? "Claude"
                              : "ChatGPT"}
                        </button>
                      ),
                    )}
                  </div>
                  <ClientInstructions client={client} />
                </div>
              </div>
            </section>
          </section>
        )}

        {section === "reports" && (
          <section className="section" aria-labelledby="reports-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Отчёты</p>
                <h1 id="reports-title">Отчёт по рекламному кабинету</h1>
                <p className="section-head__sub">
                  Выберите кабинет и период. Подготовим Word-документ или
                  презентацию с показателями, сравнением и кампаниями.
                </p>
              </div>
            </div>
            <div className="report-layout">
              <section className="panel report-panel report-builder-card">
                <p className="report-builder-card__eyebrow">
                  HOLYMEDIA MCP · ОТЧЁТ
                </p>
                <h2>Собрать отчёт</h2>
                <p className="report-builder-card__note">
                  В отчёт попадут только данные выбранного кабинета и периода.
                </p>
                <form className="report-form" onSubmit={downloadReport}>
                  <label>
                    Рекламный кабинет
                    <select
                      name="account_id"
                      required
                      value={reportAccountId}
                      onChange={(event) =>
                        setReportAccountId(event.target.value)
                      }
                    >
                      <option value="" disabled>
                        Выберите кабинет
                      </option>
                      {reportableAccounts.map(({ account, connection }) => (
                        <option key={account.id} value={account.id}>
                          {account.displayName} ·{" "}
                          {providerCopy(connection.provider).name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Период
                    <select
                      name="period"
                      value={reportDays}
                      onChange={(event) =>
                        setReportDays(Number(event.target.value))
                      }
                    >
                      <option value="7">Последние 7 дней</option>
                      <option value="14">Последние 14 дней</option>
                      <option value="30">Последние 30 дней</option>
                      <option value="90">Последние 90 дней</option>
                    </select>
                  </label>
                  <label>
                    Формат
                    <select name="format" defaultValue="docx">
                      <option value="docx">Word (.docx)</option>
                      <option value="pptx">PowerPoint (.pptx)</option>
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      busy ||
                      reportPreviewBusy ||
                      !reportableAccounts.length ||
                      !reportPreview
                    }
                  >
                    {busy
                      ? "Готовим…"
                      : reportPreviewBusy
                        ? "Проверяем данные…"
                        : "Скачать отчёт"}
                  </button>
                </form>
                {reportPreviewError && (
                  <div
                    className="report-status report-status--error"
                    role="alert"
                  >
                    <strong>Не удалось подготовить отчёт</strong>
                    <span>{reportPreviewError}</span>
                    <button
                      className="secondary-button btn--small"
                      type="button"
                      onClick={() =>
                        active &&
                        reportAccountId &&
                        void loadReportPreview(
                          active.id,
                          reportAccountId,
                          reportDays,
                        )
                      }
                    >
                      Повторить проверку
                    </button>
                  </div>
                )}
                {reportPreviewBusy && !reportPreviewError && (
                  <div className="report-status" role="status">
                    Получаем реальные показатели выбранного кабинета…
                  </div>
                )}
                {reportPreview && !reportPreviewBusy && (
                  <div className="report-data-preview">
                    <div className="report-data-preview__head">
                      <div>
                        <strong>{reportPreview.account.name}</strong>
                        <span>
                          {providerCopy(reportPreview.account.provider).name} ·{" "}
                          {reportPreview.period.startDate} —{" "}
                          {reportPreview.period.endDate}
                        </span>
                      </div>
                      <span className="status-badge ok">
                        {reportPreview.provenance.summary.realData
                          ? "Реальные данные"
                          : "Данные недоступны"}
                      </span>
                    </div>
                    <div
                      className="report-kpis"
                      aria-label="Основные показатели"
                    >
                      <span>
                        <small>Расход</small>
                        <strong>
                          {formatReportMoney(reportPreview.metrics.spend)}
                        </strong>
                      </span>
                      <span>
                        <small>Показы</small>
                        <strong>
                          {formatReportNumber(
                            reportPreview.metrics.impressions,
                          )}
                        </strong>
                      </span>
                      <span>
                        <small>Клики</small>
                        <strong>
                          {formatReportNumber(reportPreview.metrics.clicks)}
                        </strong>
                      </span>
                      <span>
                        <small>Конверсии</small>
                        <strong>
                          {formatReportNumber(
                            reportPreview.metrics.conversions,
                          )}
                        </strong>
                      </span>
                    </div>
                    <p className="report-data-preview__note">
                      В документ попадут показатели, сравнение периодов,
                      кампании и выводы только из этого источника.
                    </p>
                  </div>
                )}
                {!reportableAccounts.length && (
                  <div className="empty-state">
                    <p>
                      Для отчёта нужен подключённый и выбранный кабинет Meta Ads
                      или Google Ads.
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setSection("connections")}
                    >
                      Перейти к подключениям
                    </button>
                  </div>
                )}
              </section>
              <aside className="report-preview-card" aria-label="Отчёт">
                <div className="report-preview-card__topline">
                  <span>MONTHLY ADS REPORT</span>
                  <span>01</span>
                </div>
                <div className="report-preview-card__body">
                  <span>HOLYMEDIA MCP</span>
                  <strong>
                    Отчёт по
                    <br />
                    рекламным кампаниям
                  </strong>
                  <em>
                    {reportPreview
                      ? `${reportDays} дней · ${reportPreview.account.name}`
                      : reportableAccounts.length
                        ? "Проверяем выбранный кабинет"
                        : "Выберите кабинет и период"}
                  </em>
                </div>
                <p className="report-preview-card__footer">
                  Обложка · KPI · сравнение · кампании · выводы
                </p>
              </aside>
            </div>
          </section>
        )}

        {section === "analysis" && (
          <section className="section" aria-labelledby="analysis-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Инструменты</p>
                <h1 id="analysis-title">Анализ сайта</h1>
                <p className="section-head__sub">
                  Разберите публичную страницу и получите список понятных
                  улучшений для первого экрана, структуры и следующего шага.
                </p>
              </div>
            </div>
            <div className="analysis-layout">
              <section className="panel analysis-panel">
                <form className="site-analysis-form" onSubmit={analyzeSite}>
                  <label className="full-field">
                    Адрес сайта
                    <input
                      type="url"
                      required
                      value={analysisUrl}
                      onChange={(event) => setAnalysisUrl(event.target.value)}
                      placeholder="https://example.com"
                    />
                  </label>
                  <fieldset className="analysis-mode full-field">
                    <legend>Глубина проверки</legend>
                    <button
                      className={analysisMode === "quick" ? "is-active" : ""}
                      type="button"
                      aria-pressed={analysisMode === "quick"}
                      onClick={() => setAnalysisMode("quick")}
                    >
                      Быстрая
                    </button>
                    <button
                      className={analysisMode === "full" ? "is-active" : ""}
                      type="button"
                      aria-pressed={analysisMode === "full"}
                      onClick={() => setAnalysisMode("full")}
                    >
                      Полная
                    </button>
                  </fieldset>
                  <details className="analysis-brief full-field">
                    <summary>Уточнить задачу</summary>
                    <div className="analysis-brief__fields">
                      <label>
                        Тип сайта
                        <select
                          value={analysisBrief.siteType}
                          onChange={(event) =>
                            setAnalysisBrief((current) => ({
                              ...current,
                              siteType: event.target.value,
                            }))
                          }
                        >
                          <option value="">Определить по странице</option>
                          <option value="landing">Лендинг</option>
                          <option value="corporate">Сайт компании</option>
                          <option value="ecommerce">Интернет-магазин</option>
                          <option value="services">Услуги</option>
                        </select>
                      </label>
                      <label>
                        Цель
                        <select
                          value={analysisBrief.goal}
                          onChange={(event) =>
                            setAnalysisBrief((current) => ({
                              ...current,
                              goal: event.target.value,
                            }))
                          }
                        >
                          <option value="">Определить по странице</option>
                          <option value="Заявки">Заявки</option>
                          <option value="Продажи">Продажи</option>
                          <option value="Звонки">Звонки</option>
                          <option value="Записи">Записи</option>
                        </select>
                      </label>
                      <label>
                        Аудитория
                        <input
                          value={analysisBrief.audience}
                          maxLength={400}
                          onChange={(event) =>
                            setAnalysisBrief((current) => ({
                              ...current,
                              audience: event.target.value,
                            }))
                          }
                          placeholder="Кому вы продаёте"
                        />
                      </label>
                      <label>
                        Город или страна
                        <input
                          value={analysisBrief.region}
                          maxLength={160}
                          onChange={(event) =>
                            setAnalysisBrief((current) => ({
                              ...current,
                              region: event.target.value,
                            }))
                          }
                          placeholder="Например, Казахстан"
                        />
                      </label>
                      <label>
                        Конкурент
                        <input
                          value={analysisBrief.competitor}
                          maxLength={240}
                          onChange={(event) =>
                            setAnalysisBrief((current) => ({
                              ...current,
                              competitor: event.target.value,
                            }))
                          }
                          placeholder="Необязательно"
                        />
                      </label>
                      <label>
                        Что беспокоит
                        <input
                          value={analysisBrief.concern}
                          maxLength={400}
                          onChange={(event) =>
                            setAnalysisBrief((current) => ({
                              ...current,
                              concern: event.target.value,
                            }))
                          }
                          placeholder="Например, мало заявок"
                        />
                      </label>
                    </div>
                  </details>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={analysisBusy}
                  >
                    {analysisBusy ? "Проверяем…" : "Проанализировать сайт"}
                  </button>
                </form>
                {analysisBusy && (
                  <ol className="analysis-progress" aria-live="polite">
                    <li className="is-active">Открываем публичную страницу</li>
                    <li className={analysisStage > 0 ? "is-active" : ""}>
                      Изучаем структуру и контент
                    </li>
                    <li>Собираем рекомендации</li>
                  </ol>
                )}
                {analysisResult && (
                  <div className="analysis-result" aria-live="polite">
                    <div className="analysis-result__head">
                      <div>
                        <span className="eyebrow">Результат</span>
                        <h2>{analysisResult.url}</h2>
                      </div>
                      <span className="status-badge ok">Готово</span>
                    </div>
                    <p className="analysis-verdict">
                      {analysisResult.result.overview?.verdict}
                    </p>
                    <div className="analysis-scores">
                      {(analysisResult.result.scores ?? []).map((score) => (
                        <div key={score.id}>
                          <strong>{score.value}</strong>
                          <span>{score.label}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      className="analysis-tabs"
                      role="tablist"
                      aria-label="Разделы анализа"
                    >
                      {(
                        [
                          ["priorities", "Приоритеты"],
                          ["hero", "Первый экран"],
                          ["plan", "План"],
                          ["details", "Детали"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          className={analysisTab === id ? "is-active" : ""}
                          type="button"
                          role="tab"
                          aria-selected={analysisTab === id}
                          key={id}
                          onClick={() => setAnalysisTab(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {analysisTab === "priorities" && (
                      <div className="analysis-priorities">
                        {(analysisResult.result.topIssues ?? []).map(
                          (item, index) => (
                            <article key={`${item.title}-${index}`}>
                              <span>{item.priority}</span>
                              <h3>{item.title}</h3>
                              <p>{item.problem}</p>
                              <small>{item.evidence}</small>
                              <strong>{item.recommendation}</strong>
                            </article>
                          ),
                        )}
                        <div className="analysis-quick-wins">
                          <h3>Быстрые улучшения</h3>
                          <ul>
                            {(analysisResult.result.quickWins ?? []).map(
                              (item, index) => (
                                <li key={`${item.title}-${index}`}>
                                  {item.title}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      </div>
                    )}
                    {analysisTab === "hero" && (
                      <div className="analysis-copy-card">
                        <span>Главный заголовок</span>
                        <h3>{analysisResult.result.hero?.h1}</h3>
                        <p>{analysisResult.result.hero?.subtitle}</p>
                        <strong>{analysisResult.result.hero?.cta}</strong>
                      </div>
                    )}
                    {analysisTab === "plan" && (
                      <div className="analysis-plan">
                        <h3>План на один рабочий день</h3>
                        <ol>
                          {(analysisResult.result.oneDayPlan ?? []).map(
                            (item, index) => (
                              <li key={`${item.title}-${index}`}>
                                {item.title}
                              </li>
                            ),
                          )}
                        </ol>
                        <h3>Рекомендуемая структура</h3>
                        <ol>
                          {(analysisResult.result.structure ?? []).map(
                            (item) => (
                              <li key={item}>{item}</li>
                            ),
                          )}
                        </ol>
                        {(analysisResult.result.questions ?? []).length > 0 && (
                          <>
                            <h3>Что уточнить</h3>
                            <ul>
                              {analysisResult.result.questions?.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                    {analysisTab === "details" && (
                      <>
                        <dl className="analysis-checks">
                          <div>
                            <dt>HTTPS</dt>
                            <dd>
                              {analysisResult.result.checks?.https
                                ? "Да"
                                : "Нет"}
                            </dd>
                          </div>
                          <div>
                            <dt>Заголовок страницы</dt>
                            <dd>
                              {analysisResult.result.checks?.hasTitle
                                ? "Есть"
                                : "Нет"}
                            </dd>
                          </div>
                          <div>
                            <dt>Описание</dt>
                            <dd>
                              {analysisResult.result.checks?.hasDescription
                                ? "Есть"
                                : "Нет"}
                            </dd>
                          </div>
                          <div>
                            <dt>Один H1</dt>
                            <dd>
                              {analysisResult.result.checks?.hasSingleH1
                                ? "Да"
                                : "Проверьте"}
                            </dd>
                          </div>
                        </dl>
                        <p className="analysis-limitations">
                          {analysisResult.result.evidence?.limitations}
                        </p>
                      </>
                    )}
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void downloadSiteAnalysis(analysisResult)}
                    >
                      Скачать отчёт DOCX
                    </button>
                  </div>
                )}
              </section>
              <aside className="analysis-aside">
                <h2>Последние проверки</h2>
                {analysisHistory.length ? (
                  <ul className="analysis-history">
                    {analysisHistory.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setAnalysisResult(item)}
                        >
                          <strong>{item.url}</strong>
                          <small>
                            {new Date(item.created_at).toLocaleDateString(
                              "ru-RU",
                            )}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-inline">Здесь появятся ваши проверки.</p>
                )}
              </aside>
            </div>
          </section>
        )}

        {section === "profile" && (
          <section className="section" aria-labelledby="profile-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">Аккаунт</p>
                <h1 id="profile-title">Профиль</h1>
                <p className="section-head__sub">
                  Личные данные и безопасность аккаунта.
                </p>
              </div>
            </div>
            <div className="profile-grid">
              <section className="panel profile-card">
                <div className="avatar-editor">
                  {avatar ? (
                    <img src={avatar} alt="Фото профиля" />
                  ) : (
                    <span aria-hidden="true">
                      {profile?.name?.charAt(0).toUpperCase() || "H"}
                    </span>
                  )}
                  <label className="secondary-button btn--small">
                    Изменить фото
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => void uploadAvatar(event)}
                    />
                  </label>
                  <small>JPG, PNG или WebP, до 2 МБ</small>
                </div>
                <form onSubmit={saveProfile}>
                  <label>
                    Имя
                    <input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      minLength={2}
                      maxLength={160}
                      required
                    />
                  </label>
                  <label>
                    Email
                    <input value={profile?.email ?? ""} readOnly />
                  </label>
                  <div className="profile-summary">
                    <span>Подключено платформ</span>
                    <strong>{connectedCount}</strong>
                  </div>
                  <button className="primary-button" type="submit">
                    Сохранить
                  </button>
                </form>
              </section>
              <section className="panel profile-card">
                <h2>Сменить пароль</h2>
                <form onSubmit={changePassword}>
                  <label>
                    Текущий пароль
                    <input
                      name="current_password"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    Новый пароль
                    <input
                      name="new_password"
                      type="password"
                      minLength={12}
                      autoComplete="new-password"
                      required
                    />
                    <small>Не менее 12 символов</small>
                  </label>
                  <button className="primary-button" type="submit">
                    Сменить пароль
                  </button>
                </form>
              </section>
            </div>
          </section>
        )}
      </div>

      <SiteFooter compact />

      {confirm && (
        <div
          className="modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirm(null);
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title">{confirm.title}</h2>
            <p>{confirm.description}</p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirm(null)}
              >
                Отмена
              </button>
              <button
                className="danger-button"
                type="button"
                autoFocus
                onClick={() => {
                  const action = confirm.run;
                  setConfirm(null);
                  void action();
                }}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function ClientInstructions({ client }: { client: Client }) {
  if (client === "codex")
    return (
      <div className="client-panel" role="tabpanel">
        <h3>Codex</h3>
        <ol>
          <li>Откройте настройки Codex и раздел MCP Servers.</li>
          <li>
            Добавьте HTTP-сервер с адресом <code>{MCP_URL}</code>.
          </li>
          <li>
            В заголовке Authorization укажите{" "}
            <code>Bearer &lt;ваш ключ&gt;</code>.
          </li>
          <li>Сохраните и откройте новый чат.</li>
        </ol>
      </div>
    );
  if (client === "claude")
    return (
      <div className="client-panel" role="tabpanel">
        <h3>Claude</h3>
        <ol>
          <li>Откройте Settings → Connectors.</li>
          <li>Добавьте custom connector «HolyMedia MCP».</li>
          <li>
            Укажите адрес <code>{MCP_URL}</code>.
          </li>
          <li>Пройдите вход в HolyMedia MCP, когда Claude его откроет.</li>
        </ol>
      </div>
    );
  return (
    <div className="client-panel" role="tabpanel">
      <h3>ChatGPT</h3>
      <ol>
        <li>Откройте настройки подключений ChatGPT.</li>
        <li>
          Создайте connector с полным адресом <code>{MCP_URL}</code>.
        </li>
        <li>Выберите OAuth и автоматическую регистрацию клиента.</li>
        <li>Войдите в HolyMedia MCP и подтвердите подключение.</li>
      </ol>
    </div>
  );
}
