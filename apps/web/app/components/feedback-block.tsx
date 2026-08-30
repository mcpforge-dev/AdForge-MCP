"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLanguage } from "./language-switcher";
import { ProjectSelect } from "./project-select";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function csrf(): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("csrf");
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

function currentRoute(): string {
  const route = window.location.pathname
    .replace(/[^A-Za-z0-9_./-]/g, "")
    .slice(0, 256);
  return route.startsWith("/") ? route : "/";
}

type SupportRequestResponse = {
  telegramDelivered?: boolean;
  telegramMessageId?: string;
};

function hasConfirmedTelegramDelivery(
  value: unknown,
): value is Required<SupportRequestResponse> {
  return (
    typeof value === "object" &&
    value !== null &&
    "telegramDelivered" in value &&
    "telegramMessageId" in value &&
    value.telegramDelivered === true &&
    typeof value.telegramMessageId === "string" &&
    value.telegramMessageId.trim().length > 0
  );
}

export function FeedbackBlock({ workspaceId }: { workspaceId: string }) {
  const language = useLanguage();
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [successOpen, setSuccessOpen] = useState(false);
  const idempotencyKey = useRef<string | undefined>(undefined);
  const successDialogRef = useRef<HTMLDialogElement>(null);
  const ru = language === "ru";
  const copy = ru
    ? {
        eyebrow: "Обратная связь",
        title: "Есть пожелание по HolyMedia MCP?",
        description:
          "Опишите идею, вопрос или проблему — мы получим заявку и вернёмся с ответом.",
        category: "О чём сообщение?",
        categories: [
          { value: "SUGGESTION", label: "Пожелание" },
          { value: "PROBLEM", label: "Проблема" },
          { value: "QUESTION", label: "Вопрос" },
        ],
        message: "Ваше сообщение",
        placeholder:
          "Например: на телефоне неудобно выбрать рекламный кабинет.",
        submit: "Написать в поддержку",
        sending: "Отправляем…",
        sent: "Спасибо, сообщение отправлено",
        sentHint: "Мы получили вашу заявку и вернёмся с ответом.",
        successAction: "Хорошо",
        error: "Не удалось отправить сообщение",
        errorHint: "Попробуйте ещё раз через несколько минут.",
      }
    : {
        eyebrow: "Feedback",
        title: "Have feedback about HolyMedia MCP?",
        description:
          "Describe an idea, question, or problem. We will receive your request and reply.",
        category: "What is this about?",
        categories: [
          { value: "SUGGESTION", label: "Suggestion" },
          { value: "PROBLEM", label: "Problem" },
          { value: "QUESTION", label: "Question" },
        ],
        message: "Your message",
        placeholder:
          "For example: choosing an account is difficult on a phone.",
        submit: "Contact support",
        sending: "Sending…",
        sent: "Thank you, your message has been sent",
        sentHint: "We received your request and will get back to you.",
        successAction: "Okay",
        error: "Could not send the message",
        errorHint: "Please try again in a few minutes.",
      };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const message = String(form.get("message") ?? "").trim();
    if (!message) return;
    setState("sending");
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch(
        `${API}/api/v1/workspaces/${workspaceId}/support-requests`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({
            category: String(form.get("category") ?? "SUGGESTION"),
            message,
            sourceRoute: currentRoute(),
            locale: language,
            idempotencyKey: idempotencyKey.current,
          }),
        },
      );
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !hasConfirmedTelegramDelivery(result))
        throw new Error("support_request");
      formElement.reset();
      idempotencyKey.current = undefined;
      setState("idle");
      setSuccessOpen(true);
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    const dialog = successDialogRef.current;
    if (!dialog) return;
    if (successOpen && !dialog.open) dialog.showModal();
    if (!successOpen && dialog.open) dialog.close();
  }, [successOpen]);

  return (
    <section
      className="feedback-block"
      data-language-static
      aria-labelledby="feedback-title"
    >
      <div className="feedback-block__copy">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 id="feedback-title">{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      <form className="feedback-block__form" onSubmit={submit} noValidate>
        <label>
          {copy.category}
          <ProjectSelect
            ariaLabel={copy.category}
            name="category"
            defaultValue={copy.categories[0]!.value}
            options={copy.categories}
          />
        </label>
        <label>
          {copy.message}
          <textarea
            name="message"
            placeholder={copy.placeholder}
            rows={3}
            required
            minLength={3}
            maxLength={4000}
          />
        </label>
        <div className="feedback-block__actions">
          <button
            className="secondary-button"
            type="submit"
            disabled={state === "sending"}
          >
            {state === "sending" ? copy.sending : copy.submit}
          </button>
          {state === "error" && (
            <p className="feedback-block__error" role="alert">
              <strong>{copy.error}</strong>
              <span>{copy.errorHint}</span>
            </p>
          )}
        </div>
      </form>
      <dialog
        ref={successDialogRef}
        className="feedback-success-dialog"
        aria-labelledby="feedback-success-title"
        aria-describedby="feedback-success-description"
        onClose={() => {
          setSuccessOpen(false);
          setState("idle");
        }}
      >
        <form method="dialog" className="feedback-success-dialog__content">
          <span className="feedback-success-dialog__icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2 id="feedback-success-title">{copy.sent}</h2>
            <p id="feedback-success-description">{copy.sentHint}</p>
          </div>
          <div className="feedback-success-dialog__actions">
            <button className="primary-button" type="submit" autoFocus>
              {copy.successAction}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
