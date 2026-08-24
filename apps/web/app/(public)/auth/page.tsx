"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
type AuthMode = "login" | "signup" | "forgot";

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  const data = (await response.json()) as { csrfToken: string };
  return data.csrfToken;
}

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("mode");
    if (requested === "signup" || requested === "forgot") setMode(requested);
  }, []);

  function changeMode(next: AuthMode) {
    setMode(next);
    setMessage("");
    setError("");
    const url = next === "login" ? "/auth" : `/auth?mode=${next}`;
    window.history.replaceState({}, "", url);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
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
      const response = await fetch(
        `${API}/api/v1/auth/${mode === "forgot" ? "forgot-password" : mode}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify(body),
        },
      );
      const data = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(
          data.error?.message ??
            "Не удалось выполнить запрос. Попробуйте ещё раз.",
        );
      }
      if (mode === "forgot") {
        setMessage(
          "Если такой аккаунт есть, мы отправили письмо со ссылкой для сброса пароля.",
        );
      } else {
        window.location.assign("/dashboard");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось выполнить запрос. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="back-link" href="/">
          ← Вернуться на главную
        </Link>

        {mode !== "forgot" ? (
          <div
            className="tabs"
            role="tablist"
            aria-label="Вход или регистрация"
          >
            <button
              className={mode === "login" ? "tab active" : "tab"}
              onClick={() => changeMode("login")}
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              aria-controls="auth-panel"
            >
              Войти
            </button>
            <button
              className={mode === "signup" ? "tab active" : "tab"}
              onClick={() => changeMode("signup")}
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              aria-controls="auth-panel"
            >
              Регистрация
            </button>
          </div>
        ) : (
          <button
            className="text-button auth-back-button"
            type="button"
            onClick={() => changeMode("login")}
          >
            ← Назад ко входу
          </button>
        )}

        <div id="auth-panel" role={mode === "forgot" ? undefined : "tabpanel"}>
          <h1 id="auth-title">
            {mode === "login"
              ? "Вход"
              : mode === "signup"
                ? "Новый аккаунт"
                : "Восстановление пароля"}
          </h1>
          <p className="muted">
            {mode === "login"
              ? "Войдите, чтобы открыть рекламные кабинеты."
              : mode === "signup"
                ? "Создайте аккаунт HolyMedia MCP."
                : "Укажите email, который использовали при регистрации."}
          </p>

          {mode !== "forgot" && (
            <>
              <a
                className="secondary-button google-login-button"
                href={`${API}/auth/google/start`}
              >
                Войти через Google
              </a>
              <div className="auth-divider" aria-hidden="true">
                <span>или через email</span>
              </div>
            </>
          )}

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
                  placeholder="Ваше имя"
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
                placeholder="name@company.com"
              />
            </label>
            {mode !== "forgot" && (
              <label>
                Пароль
                <input
                  name="password"
                  required
                  minLength={mode === "signup" ? 12 : 1}
                  maxLength={128}
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "signup" ? "Минимум 12 символов" : "Ваш пароль"
                  }
                />
              </label>
            )}
            {mode === "login" && (
              <button
                className="text-button forgot-link"
                type="button"
                onClick={() => changeMode("forgot")}
              >
                Забыли пароль?
              </button>
            )}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy
                ? "Подождите…"
                : mode === "login"
                  ? "Войти"
                  : mode === "signup"
                    ? "Зарегистрироваться"
                    : "Отправить ссылку"}
            </button>
          </form>
        </div>

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
