"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  const data = (await response.json()) as { csrfToken: string };
  return data.csrfToken;
}

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    const form = new FormData(event.currentTarget);
    const body =
      mode === "forgot"
        ? { email: String(form.get("email") ?? "") }
        : mode === "login"
          ? {
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
            }
          : {
              name: String(form.get("name") ?? ""),
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
            };
    try {
      const token = await csrf();
      const response = await fetch(
        `${API}/api/v1/auth/${mode === "forgot" ? "forgot-password" : mode}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify(body),
        },
      );
      const data = (await response.json()) as {
        error?: { message?: string };
        user?: unknown;
      };
      if (!response.ok)
        throw new Error(data.error?.message ?? "Не удалось выполнить запрос.");
      if (mode === "forgot")
        setMessage(
          "Если аккаунт существует, инструкции отправлены на электронную почту.",
        );
      else window.location.assign("/dashboard");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось выполнить запрос.",
      );
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="back-link" href="/">
          HolyMedia MCP v2
        </Link>
        <div className="tabs" role="tablist" aria-label="Аутентификация">
          <button
            className={mode === "login" ? "tab active" : "tab"}
            onClick={() => setMode("login")}
            type="button"
          >
            Войти
          </button>
          <button
            className={mode === "signup" ? "tab active" : "tab"}
            onClick={() => setMode("signup")}
            type="button"
          >
            Создать аккаунт
          </button>
          <button
            className={mode === "forgot" ? "tab active" : "tab"}
            onClick={() => setMode("forgot")}
            type="button"
          >
            Сбросить пароль
          </button>
        </div>
        <h1 id="auth-title">
          {mode === "login"
            ? "Вход"
            : mode === "signup"
              ? "Новый аккаунт"
              : "Восстановление доступа"}
        </h1>
        <p className="muted">
          {mode === "login"
            ? "Откройте рабочее пространство HolyMedia."
            : mode === "signup"
              ? "Создайте защищённое рабочее пространство."
              : "Введите email. Ответ не раскрывает наличие аккаунта."}
        </p>
        <a
          className="secondary-button google-login-button"
          href={`${API}/auth/google/start`}
        >
          Войти через Google
        </a>
        <p className="auth-divider">или через email</p>
        <form onSubmit={submit}>
          {mode === "signup" && (
            <label>
              Имя
              <input
                name="name"
                required
                minLength={2}
                maxLength={160}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              required
              type="email"
              maxLength={320}
              autoComplete="email"
            />
          </label>
          {mode !== "forgot" && (
            <label>
              Пароль
              <input
                name="password"
                required
                minLength={12}
                maxLength={128}
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </label>
          )}
          <button className="primary-button" type="submit">
            {mode === "login"
              ? "Войти"
              : mode === "signup"
                ? "Зарегистрироваться"
                : "Отправить"}
          </button>
        </form>
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
