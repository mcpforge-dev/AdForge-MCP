"use client";

import { type FormEvent, useState } from "react";
import { useLanguage } from "./language-switcher";

const supportEmail =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "mcp@holymedia.kz";

export function FeedbackBlock() {
  const language = useLanguage();
  const [sent, setSent] = useState(false);
  const copy =
    language === "ru"
      ? {
          eyebrow: "Обратная связь",
          title: "Есть пожелание по HolyMedia MCP?",
          description:
            "Опишите идею или проблему. Откроется письмо в поддержку с уже заполненной темой.",
          category: "О чём сообщение?",
          categories: ["Пожелание", "Проблема", "Вопрос"],
          message: "Ваше сообщение",
          placeholder: "Например: на телефоне неудобно выбрать кабинет.",
          submit: "Написать в поддержку",
          sent: "Почтовое приложение открыто. Отправьте письмо, когда будете готовы.",
          subject: "Обратная связь по HolyMedia MCP",
        }
      : {
          eyebrow: "Feedback",
          title: "Have feedback about HolyMedia MCP?",
          description:
            "Describe an idea or problem. Your email app will open with a prepared subject.",
          category: "What is this about?",
          categories: ["Suggestion", "Problem", "Question"],
          message: "Your message",
          placeholder:
            "For example: choosing an account is difficult on a phone.",
          submit: "Contact support",
          sent: "Your email app is open. Send the message when you are ready.",
          subject: "HolyMedia MCP feedback",
        };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const category = String(form.get("category") ?? "");
    const message = String(form.get("message") ?? "").trim();
    if (!message) return;
    const subject = `${copy.subject}: ${category}`;
    window.location.assign(
      `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
    );
    setSent(true);
  }

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
      <form className="feedback-block__form" onSubmit={submit}>
        <label>
          {copy.category}
          <select name="category" defaultValue={copy.categories[0]}>
            {copy.categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label>
          {copy.message}
          <textarea
            name="message"
            placeholder={copy.placeholder}
            rows={3}
            required
          />
        </label>
        <div className="feedback-block__actions">
          <button className="secondary-button" type="submit">
            {copy.submit}
          </button>
          {sent && <p role="status">{copy.sent}</p>}
        </div>
      </form>
    </section>
  );
}
