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
  const [readResult, setReadResult] = useState<unknown>(null);
  const [siteResult, setSiteResult] = useState<unknown>(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [error, setError] = useState("");

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

  useEffect(() => {
    void loadWorkspaces();
  }, []);
  useEffect(() => {
    if (!active) return;
    void loadMembers(active);
    void loadConnections(active);
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
