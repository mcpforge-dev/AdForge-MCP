"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function ResetPasswordPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const csrfResponse = await fetch(`${API}/api/v1/auth/csrf`, {
      credentials: "include",
    });
    const csrfData = (await csrfResponse.json()) as { csrfToken: string };
    const response = await fetch(`${API}/api/v1/auth/reset-password`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfData.csrfToken,
      },
      body: JSON.stringify({
        token: form.get("token"),
        password: form.get("password"),
      }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } };
      setError(data.error?.message ?? "Ссылка недействительна.");
      return;
    }
    setMessage("Пароль изменён. Можно войти.");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="back-link" href="/auth">
          Назад ко входу
        </Link>
        <h1>Новый пароль</h1>
        <form onSubmit={submit}>
          <label>
            Код из письма
            <input name="token" required minLength={32} />
          </label>
          <label>
            Новый пароль
            <input
              name="password"
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <button className="primary-button" type="submit">
            Сохранить пароль
          </button>
        </form>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
