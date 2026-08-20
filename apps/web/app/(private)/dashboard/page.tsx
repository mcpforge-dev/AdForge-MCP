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

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  const data = (await response.json()) as { csrfToken: string };
  return data.csrfToken;
}

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
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
      current && data.find((item) => item.id === current.id)
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

  useEffect(() => {
    void loadWorkspaces();
  }, []);
  useEffect(() => {
    if (active) void loadMembers(active);
  }, [active]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const token = await csrf();
    const response = await fetch(`${API}/api/v1/workspaces`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": token },
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
    const token = await csrf();
    const response = await fetch(
      `${API}/api/v1/workspaces/${active.id}/invitations`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": token },
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
    const token = await csrf();
    await fetch(`${API}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": token },
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
                <option value="MEMBER">MEMBER</option>
                <option value="VIEWER">VIEWER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <button className="primary-button" type="submit">
                Пригласить
              </button>
            </form>
          )}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
