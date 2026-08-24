"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { SiteFooter } from "../../components/site-footer";

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
type Section = "overview" | "connections" | "mcp" | "reports" | "profile";
type Client = "codex" | "claude" | "chatgpt";
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
  return { label: "Не подключено", tone: "info" };
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
  const [savingAccounts, setSavingAccounts] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState("");
  const [reportDays, setReportDays] = useState(7);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  const canManage = Boolean(active && ["OWNER", "ADMIN"].includes(active.role));
  const enabledAccounts = useMemo(
    () =>
      connections.flatMap((connection) =>
        connection.accounts
          .filter((account) => account.enabled)
          .map((account) => ({ account, connection })),
      ),
    [connections],
  );
  const connectedCount = connections.filter((connection) =>
    ["CONNECTED", "DEGRADED"].includes(connection.status),
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
      requestedSection === "profile"
    )
      setSection(requestedSection);
    if (query.get("oauth") === "success")
      notify("Платформа подключена. Выберите кабинеты для работы.");
    if (query.get("oauth") === "error")
      fail(
        "Подключение не завершено. Попробуйте ещё раз или обратитесь в поддержку.",
      );
    if (query.has("oauth")) window.history.replaceState({}, "", "/dashboard");
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadConnections(active);
    void loadTokens(active);
  }, [active]);

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
    setBusy(true);
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
      setBusy(false);
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
      const responses = await Promise.all(
        changes.map((account) =>
          fetch(
            `${API}/api/v1/workspaces/${active.id}/provider-accounts/${account.id}`,
            {
              method: "PATCH",
              credentials: "include",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": csrfToken,
              },
              body: JSON.stringify({ enabled: selected.has(account.id) }),
            },
          ),
        ),
      );
      if (responses.some((response) => !response.ok)) throw new Error();
      await loadConnections(active);
      notify("Выбранные кабинеты сохранены.");
    } catch {
      await loadConnections(active);
      fail("Не удалось сохранить выбор. Изменения отменены.");
    } finally {
      setSavingAccounts(null);
    }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const accountIds = form.getAll("account_ids");
    if (!accountIds.length) {
      fail("Выберите хотя бы один кабинет для ключа.");
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

  async function downloadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("account_id") ?? "");
    if (!accountId) return;
    setBusy(true);
    try {
      const query = new URLSearchParams({
        accountId,
        ...dateRange(reportDays),
      });
      const response = await fetch(
        `${API}/api/v1/workspaces/${active.id}/reports/performance.docx?${query}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "holymedia-performance-report.docx";
      link.click();
      URL.revokeObjectURL(url);
      notify("Отчёт готов.");
    } catch {
      fail("Не удалось собрать отчёт. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
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
    { label: "Тарифы", disabled: true },
  ];
  const allProviderIds = [
    "GOOGLE_ADS",
    "META_ADS",
    "YANDEX_DIRECT",
    "TIKTOK_ADS",
    "GOOGLE_SEARCH_CONSOLE",
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
                  Подключите платформу и выберите кабинеты, доступные в
                  AI-клиенте.
                </p>
              </div>
            </div>
            <div className="connection-list">
              {allProviderIds.map((providerId) => {
                const definition = providers.find(
                  (item) => item.id === providerId,
                );
                const connection = connections.find(
                  (item) => item.provider === providerId,
                );
                const copyText = providerCopy(providerId);
                const comingSoon = providerId === "GOOGLE_SEARCH_CONSOLE";
                const status = connectionStatus(connection?.status ?? "");
                const selected = new Set(
                  connection ? (drafts[connection.id] ?? []) : [],
                );
                return (
                  <article className="connection-card" key={providerId}>
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
                      {comingSoon ? (
                        <span className="status-badge info">В разработке</span>
                      ) : (
                        <span className={`status-badge ${status.tone}`}>
                          {status.label}
                        </span>
                      )}
                    </div>
                    {comingSoon ? (
                      <p className="connection-note">
                        Подключение появится позже.
                      </p>
                    ) : connection ? (
                      <>
                        <div className="connection-actions">
                          <button
                            className="secondary-button btn--small"
                            type="button"
                            disabled={busy}
                            onClick={() => void discover(connection)}
                          >
                            Обновить кабинеты
                          </button>
                          <button
                            className="ghost-button btn--small"
                            type="button"
                            onClick={() => void startProvider(providerId)}
                          >
                            Подключить заново
                          </button>
                          <button
                            className="danger-link"
                            type="button"
                            onClick={() =>
                              setConfirm({
                                title: `Отключить ${copyText.name}?`,
                                description:
                                  "Кабинеты этой платформы перестанут быть доступны в AI-клиенте.",
                                confirmLabel: "Отключить",
                                run: () => disconnect(connection),
                              })
                            }
                          >
                            Отключить
                          </button>
                        </div>
                        <div className="account-selector">
                          <div className="account-selector__head">
                            <div>
                              <h3>Выберите кабинеты</h3>
                              <p>
                                {selected.size} из {connection.accounts.length}
                              </p>
                            </div>
                            {connection.accounts.length > 0 && (
                              <div className="bulk-actions">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDrafts((current) => ({
                                      ...current,
                                      [connection.id]: connection.accounts.map(
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
                                <label className="account-row" key={account.id}>
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
                      </>
                    ) : (
                      <div className="connection-empty">
                        <p>Платформа ещё не подключена.</p>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={busy || definition?.status === "DISABLED"}
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
                      <fieldset className="account-picker">
                        <legend>Кабинеты</legend>
                        {enabledAccounts.length ? (
                          enabledAccounts.map(({ account, connection }) => (
                            <label className="check-row" key={account.id}>
                              <input
                                type="checkbox"
                                name="account_ids"
                                value={account.id}
                              />
                              <span>{account.displayName}</span>
                              <small>
                                {providerCopy(connection.provider).name}
                              </small>
                            </label>
                          ))
                        ) : (
                          <p className="empty-inline">
                            Сначала выберите кабинеты в разделе «Подключения».
                          </p>
                        )}
                      </fieldset>
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
                  Выберите кабинет и период. Мы подготовим DOCX с основными
                  показателями и сравнением.
                </p>
              </div>
            </div>
            <section className="panel report-panel">
              <form className="report-form" onSubmit={downloadReport}>
                <label>
                  Рекламный кабинет
                  <select name="account_id" required defaultValue="">
                    <option value="" disabled>
                      Выберите кабинет
                    </option>
                    {enabledAccounts.map(({ account, connection }) => (
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
                  </select>
                </label>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy || !enabledAccounts.length}
                >
                  {busy ? "Готовим…" : "Скачать DOCX"}
                </button>
              </form>
              {!enabledAccounts.length && (
                <div className="empty-state">
                  <p>
                    Чтобы создать отчёт, сначала выберите рекламный кабинет.
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
                  <button className="secondary-button" type="submit">
                    Изменить пароль
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
