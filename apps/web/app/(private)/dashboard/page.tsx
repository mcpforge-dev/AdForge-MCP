"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Workspace = { id: string; name: string; slug: string; role: string };
type Member = {
  userId: string;
  role: string;
  user: { name: string; email: string; emailVerifiedAt: string | null };
};
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
  requestedScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
  accounts: ProviderAccount[];
};
type ManualRequest = {
  id: string;
  workspace_id: string;
  provider: string;
  company_name: string;
  meta_ad_account_id: string;
  status: string;
  specialist_note: string;
  created_at: string;
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

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  const data = (await response.json()) as { csrfToken: string };
  return data.csrfToken;
}

function lastSevenDays(): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - 6 * 86_400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [manualRequests, setManualRequests] = useState<ManualRequest[]>([]);
  const [adminManualRequests, setAdminManualRequests] = useState<
    ManualRequest[]
  >([]);
  const [supportAccess, setSupportAccess] = useState(false);
  const [readResult, setReadResult] = useState<unknown>(null);
  const [siteResult, setSiteResult] = useState<unknown>(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [serviceTokens, setServiceTokens] = useState<ServiceToken[]>([]);
  const [createdServiceToken, setCreatedServiceToken] = useState("");
  const [error, setError] = useState("");

  async function loadManualRequests() {
    const [response, adminResponse] = await Promise.all([
      fetch(`${API}/api/connection-requests`, {
        credentials: "include",
      }),
      active && ["OWNER", "ADMIN"].includes(active.role)
        ? fetch(`${API}/api/admin/connection-requests`, {
            credentials: "include",
          })
        : Promise.resolve(null),
    ]);
    if (response.ok) {
      const data = (await response.json()) as { requests: ManualRequest[] };
      setManualRequests(data.requests);
    }
    if (adminResponse?.ok) {
      const data = (await adminResponse.json()) as {
        requests: ManualRequest[];
        support_access?: boolean;
      };
      setAdminManualRequests(data.requests);
      setSupportAccess(Boolean(data.support_access));
    } else {
      setAdminManualRequests([]);
      setSupportAccess(false);
    }
  }

  async function startManualMeta(requestId: string) {
    const response = await fetch(
      `${API}/api/admin/connection-requests/meta/authorize-url`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ request_id: requestId }),
      },
    );
    if (!response.ok) {
      setError("Не удалось начать подключение Meta по заявке.");
      return;
    }
    const data = (await response.json()) as { authorization_url: string };
    window.location.assign(data.authorization_url);
  }

  async function loadWorkspaces() {
    const response = await fetch(`${API}/api/v1/workspaces`, {
      credentials: "include",
    });
    if (!response.ok) {
      window.location.assign("/auth");
      return;
    }
    const data = (await response.json()) as Workspace[];
    setWorkspaces(data);
    setActive((current) =>
      current && data.some((item) => item.id === current.id)
        ? current
        : (data[0] ?? null),
    );
  }

  async function loadMembers(workspace: Workspace) {
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/members`,
      { credentials: "include" },
    );
    if (response.ok) setMembers((await response.json()) as Member[]);
  }

  async function loadConnections(workspace: Workspace) {
    const [providerResponse, connectionResponse] = await Promise.all([
      fetch(`${API}/api/v1/providers`, { credentials: "include" }),
      fetch(`${API}/api/v1/workspaces/${workspace.id}/connections`, {
        credentials: "include",
      }),
    ]);
    if (providerResponse.ok)
      setProviders((await providerResponse.json()) as Provider[]);
    if (connectionResponse.ok)
      setConnections((await connectionResponse.json()) as Connection[]);
  }

  async function loadServiceTokens(workspace: Workspace) {
    if (!["OWNER", "ADMIN"].includes(workspace.role)) {
      setServiceTokens([]);
      return;
    }
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspace.id}/service-tokens`,
      { credentials: "include" },
    );
    if (response.ok) setServiceTokens((await response.json()) as ServiceToken[]);
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);
  useEffect(() => {
    if (!active) return;
    void loadMembers(active);
    void loadConnections(active);
    void loadServiceTokens(active);
    void loadManualRequests();
  }, [active]);

  async function startProvider(provider: string) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/connections/${provider}/oauth/start`,
      {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    if (!response.ok) {
      setError("Не удалось начать подключение провайдера.");
      return;
    }
    const data = (await response.json()) as { authorizationUrl: string };
    window.location.assign(data.authorizationUrl);
  }

  async function disconnect(connectionId: string) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/connections/${connectionId}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    if (response.ok) await loadConnections(active);
    else setError("Не удалось отключить провайдера.");
  }

  async function discover(connectionId: string) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/connections/${connectionId}/accounts/discover`,
      {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    if (response.ok) await loadConnections(active);
    else setError("Не удалось обновить список рекламных кабинетов.");
  }

  async function toggleAccount(accountId: string, enabled: boolean) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/provider-accounts/${accountId}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ enabled }),
      },
    );
    if (response.ok) await loadConnections(active);
    else setError("Не удалось изменить доступ к рекламному кабинету.");
  }

  async function readSmoke(connection: Connection, account: ProviderAccount) {
    if (!active) return;
    const dates = lastSevenDays();
    const query = new URLSearchParams(dates).toString();
    const [health, metrics, campaigns] = await Promise.all([
      fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}/accounts/${account.id}/health`,
        { credentials: "include" },
      ),
      fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}/accounts/${account.id}/metrics?${query}`,
        { credentials: "include" },
      ),
      fetch(
        `${API}/api/v1/workspaces/${active.id}/connections/${connection.id}/accounts/${account.id}/campaigns?${query}&limit=10`,
        { credentials: "include" },
      ),
    ]);
    if (!health.ok || !metrics.ok || !campaigns.ok) {
      setError("Не удалось выполнить read-проверку рекламного кабинета.");
      return;
    }
    setReadResult({
      account: account.displayName,
      period: dates,
      health: await health.json(),
      metrics: await metrics.json(),
      campaigns: await campaigns.json(),
    });
  }

  async function downloadReport(account: ProviderAccount) {
    if (!active) return;
    const query = new URLSearchParams({
      accountId: account.id,
      ...lastSevenDays(),
    }).toString();
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/reports/performance.docx?${query}`,
      { credentials: "include" },
    );
    if (!response.ok) {
      setError("Не удалось собрать DOCX-отчёт.");
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await response.blob());
    link.download = "holymedia-performance-report.docx";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function analyzeSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !siteUrl.trim()) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/site-analysis`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({ url: siteUrl.trim() }),
      },
    );
    if (!response.ok) {
      setError("Не удалось проанализировать сайт.");
      return;
    }
    setSiteResult(await response.json());
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${API}/api/v1/workspaces`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({ name: form.get("name") }),
    });
    if (!response.ok) {
      setError("Не удалось создать workspace.");
      return;
    }
    event.currentTarget.reset();
    await loadWorkspaces();
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/invitations`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": await csrf(),
        },
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role"),
        }),
      },
    );
    if (!response.ok) {
      setError("Не удалось создать приглашение.");
      return;
    }
    event.currentTarget.reset();
    setError("");
  }

  async function requestManualMeta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${API}/api/connection-requests/meta`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(),
      },
      body: JSON.stringify({
        workspace_id: active.id,
        company_name: form.get("company_name"),
        ad_account_id: form.get("ad_account_id"),
        business_id: form.get("business_id") || undefined,
        page_id: form.get("page_id") || undefined,
        instagram_username: form.get("instagram_username") || undefined,
        contact_preference: form.get("contact_preference"),
        client_note: form.get("client_note") || undefined,
      }),
    });
    if (!response.ok) {
      setError("Не удалось отправить заявку на ручное подключение Meta.");
      return;
    }
    event.currentTarget.reset();
    setError("");
    await loadManualRequests();
  }

  async function createServiceToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
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
          accountIds: form.getAll("account_ids"),
          expiresInDays: Number(form.get("expires_in_days") || 90),
        }),
      },
    );
    if (!response.ok) {
      setError("Не удалось создать служебный MCP-токен.");
      return;
    }
    const token = (await response.json()) as ServiceToken & { token: string };
    setCreatedServiceToken(token.token);
    event.currentTarget.reset();
    await loadServiceTokens(active);
  }

  async function revokeServiceToken(tokenId: string) {
    if (!active) return;
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/service-tokens/${tokenId}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": await csrf() },
      },
    );
    if (!response.ok) {
      setError("Не удалось отозвать служебный MCP-токен.");
      return;
    }
    await loadServiceTokens(active);
  }

  async function logout() {
    await fetch(`${API}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": await csrf() },
    });
    window.location.assign("/auth");
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">HolyMedia MCP v2</p>
          <h1>Рабочее пространство</h1>
        </div>
        <button className="ghost-button" onClick={() => void logout()}>
          Выйти
        </button>
      </header>

      <section className="dashboard-grid">
        <div className="panel">
          <label>
            Активный workspace
            <select
              value={active?.id ?? ""}
              onChange={(event) =>
                setActive(
                  workspaces.find((item) => item.id === event.target.value) ??
                    null,
                )
              }
            >
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.role}
                </option>
              ))}
            </select>
          </label>
          <form onSubmit={createWorkspace} className="inline-form">
            <input
              name="name"
              required
              minLength={2}
              placeholder="Новый workspace"
            />
            <button className="primary-button" type="submit">
              Создать
            </button>
          </form>
        </div>
        <div className="panel">
          <h2>Участники</h2>
          {members.map((member) => (
            <div className="member-row" key={member.userId}>
              <span>
                <strong>{member.user.name}</strong>
                <small>{member.user.email}</small>
              </span>
              <em>{member.role}</em>
            </div>
          ))}
          {active && (
            <form onSubmit={invite} className="invite-form">
              <input
                name="email"
                type="email"
                required
                placeholder="Email участника"
              />
              <select name="role" defaultValue="MEMBER">
                <option value="MEMBER">Участник</option>
                <option value="VIEWER">Наблюдатель</option>
                <option value="ADMIN">Администратор</option>
              </select>
              <button className="primary-button" type="submit">
                Пригласить
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="panel connections-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Providers</p>
            <h2>Подключения рекламных платформ</h2>
          </div>
          <span className="muted">
            Доступы хранятся отдельно для каждого workspace
          </span>
        </div>
        <div className="provider-list">
          {providers.map((provider) => {
            const connection = connections.find(
              (item) => item.provider === provider.id,
            );
            return (
              <div className="provider-row" key={provider.id}>
                <div>
                  <strong>{provider.displayName}</strong>
                  <small>
                    {connection
                      ? `${connection.status} · аккаунтов: ${connection.accounts.length}`
                      : provider.status}
                  </small>
                </div>
                <div className="provider-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!provider.oauth}
                    onClick={() => void startProvider(provider.id)}
                  >
                    {connection ? "Переподключить" : "Подключить"}
                  </button>
                  {connection && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void disconnect(connection.id)}
                    >
                      Отключить
                    </button>
                  )}
                </div>
                {connection && (
                  <div className="provider-details">
                    <small>
                      Разрешения: {connection.grantedScopes.length}/
                      {connection.requestedScopes.length}
                      {connection.missingScopes.length
                        ? ` · не хватает: ${connection.missingScopes.join(", ")}`
                        : ""}
                    </small>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void discover(connection.id)}
                    >
                      Обновить кабинеты
                    </button>
                    {connection.accounts.map((account) => (
                      <div className="account-row" key={account.id}>
                        <input
                          type="checkbox"
                          checked={account.enabled}
                          onChange={(event) =>
                            void toggleAccount(account.id, event.target.checked)
                          }
                        />
                        <span>{account.displayName}</span>
                        <small>
                          {account.externalAccountId} ·{" "}
                          {account.status ?? "неизвестно"}
                        </small>
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={!account.enabled}
                          onClick={() => void readSmoke(connection, account)}
                        >
                          Проверить чтение
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={!account.enabled}
                          onClick={() => void downloadReport(account)}
                        >
                          DOCX-отчёт
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {active && ["OWNER", "ADMIN"].includes(active.role) && (
        <section className="panel connections-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">MCP</p>
              <h2>Доступ для AI-клиента и Гермеса</h2>
            </div>
            <span className="muted">
              Токен показывается один раз. Ограничьте его только нужными кабинетами.
            </span>
          </div>
          <form onSubmit={createServiceToken} className="token-form">
            <label>
              Название
              <input name="name" required minLength={2} placeholder="Например, Гермес" />
            </label>
            <label>
              Срок действия
              <select name="expires_in_days" defaultValue="90">
                <option value="30">30 дней</option>
                <option value="90">90 дней</option>
                <option value="365">1 год</option>
              </select>
            </label>
            <fieldset className="account-picker">
              <legend>Разрешённые рекламные кабинеты</legend>
              {connections.flatMap((connection) =>
                connection.accounts
                  .filter((account) => account.enabled)
                  .map((account) => (
                    <label key={account.id} className="check-row">
                      <input type="checkbox" name="account_ids" value={account.id} />
                      <span>{account.displayName}</span>
                      <small>{connection.provider}</small>
                    </label>
                  )),
              )}
              {!connections.some((connection) =>
                connection.accounts.some((account) => account.enabled),
              ) && <small className="muted">Сначала подключите рекламный кабинет.</small>}
            </fieldset>
            <label className="check-row">
              <input type="checkbox" name="write" />
              <span>Разрешить подтверждаемые write-запросы</span>
              <small>Фактические изменения всё ещё блокируются preview-only policy.</small>
            </label>
            <button className="primary-button" type="submit">
              Создать токен
            </button>
          </form>
          {createdServiceToken && (
            <div className="one-time-secret" role="status">
              <strong>Сохраните токен сейчас</strong>
              <textarea readOnly value={createdServiceToken} rows={3} />
              <button
                className="ghost-button"
                type="button"
                onClick={() => setCreatedServiceToken("")}
              >
                Скрыть
              </button>
            </div>
          )}
          <div className="provider-details">
            {serviceTokens.map((token) => (
              <div className="member-row" key={token.id}>
                <span>
                  <strong>{token.name}</strong>
                  <small>
                    {token.tokenPrefix}… · {token.scopes.join(", ")} · кабинетов: {token.accountIds.length || "все workspace"}
                  </small>
                </span>
                {token.revokedAt ? (
                  <em>Отозван</em>
                ) : (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void revokeServiceToken(token.id)}
                  >
                    Отозвать
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Meta onboarding</p>
            <h2>Подключение Meta с помощью специалиста</h2>
          </div>
          <span className="muted">
            Не передавайте пароли, токены и секреты. Специалист поможет пройти
            официальную авторизацию Meta.
          </span>
        </div>
        <form onSubmit={requestManualMeta} className="invite-form">
          <input name="company_name" required placeholder="Название компании" />
          <input
            name="ad_account_id"
            required
            placeholder="ID рекламного кабинета, например 123456789"
          />
          <input name="business_id" placeholder="Business ID (необязательно)" />
          <input name="page_id" placeholder="Page ID (необязательно)" />
          <input
            name="instagram_username"
            placeholder="Instagram @username (необязательно)"
          />
          <select name="contact_preference" defaultValue="email">
            <option value="email">Связаться по email</option>
            <option value="telegram">Связаться в Telegram</option>
            <option value="whatsapp">Связаться в WhatsApp</option>
          </select>
          <textarea
            name="client_note"
            maxLength={2000}
            placeholder="Комментарий для специалиста, без паролей и токенов"
          />
          <button className="primary-button" type="submit">
            Оставить заявку
          </button>
        </form>
        {manualRequests.length > 0 && (
          <div className="provider-details">
            <strong>Ваши заявки</strong>
            {manualRequests
              .filter((item) => item.workspace_id === active?.id)
              .map((item) => (
                <div className="member-row" key={item.id}>
                  <span>
                    <strong>{item.company_name}</strong>
                    <small>
                      Meta · {item.meta_ad_account_id} ·{" "}
                      {item.created_at.slice(0, 10)}
                    </small>
                  </span>
                  <em>{item.status}</em>
                </div>
              ))}
          </div>
        )}
        {adminManualRequests.filter(
          (item) => supportAccess || item.workspace_id === active?.id,
        ).length > 0 && (
          <div className="provider-details">
            <strong>
              {supportAccess ? "Очередь поддержки" : "Заявки workspace"}
            </strong>
            {adminManualRequests
              .filter(
                (item) => supportAccess || item.workspace_id === active?.id,
              )
              .map((item) => (
                <div className="member-row" key={item.id}>
                  <span>
                    <strong>{item.company_name}</strong>
                    <small>
                      {item.meta_ad_account_id} · {item.status}
                    </small>
                  </span>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={item.status === "COMPLETED"}
                    onClick={() => void startManualMeta(item.id)}
                  >
                    Войти в Meta и подключить
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Site analysis</p>
            <h2>Анализ сайта</h2>
          </div>
          <span className="muted">
            Проверяется только публичный HTTP(S)-адрес
          </span>
        </div>
        <form onSubmit={analyzeSite} className="inline-form">
          <input
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.target.value)}
            type="url"
            required
            placeholder="https://example.com"
          />
          <button className="primary-button" type="submit">
            Проверить
          </button>
        </form>
        {siteResult !== null && (
          <pre>{JSON.stringify(siteResult, null, 2)}</pre>
        )}
      </section>

      {readResult !== null && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Read-only smoke</p>
              <h2>Последний ответ провайдера</h2>
            </div>
          </div>
          <pre>{JSON.stringify(readResult, null, 2)}</pre>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
