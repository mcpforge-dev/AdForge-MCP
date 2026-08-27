"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SUPPORT_FEATURES,
  TARIFF_FEATURES,
  TARIFF_PLANS,
  type TariffServiceLevel,
} from "@holymedia/contracts";
import { useLanguage } from "./language-switcher";
import {
  SubscriptionInfo,
  type SubscriptionInfoValue,
} from "./subscription-info";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;
}

export function TariffCatalog({
  subscription,
  workspaceId,
}: {
  subscription?: SubscriptionInfoValue | null;
  workspaceId?: string | undefined;
}) {
  const language = useLanguage();
  const ru = language === "ru";
  const [level, setLevel] = useState<TariffServiceLevel>("SELF_SERVICE");
  const [requestedPlan, setRequestedPlan] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const currentKey = subscription?.plan?.key;

  async function requestPlan(planKey: string) {
    if (!workspaceId) return;
    setPendingPlan(planKey);
    setRequestError(null);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${workspaceId}/billing/tariff-requests`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ planKey }),
        },
      );
      if (!response.ok) throw new Error("request_failed");
      setRequestedPlan(null);
      setRequestSent(true);
    } catch {
      setRequestError(
        ru
          ? "Не удалось отправить запрос. Попробуйте ещё раз."
          : "The request could not be sent. Please try again.",
      );
    } finally {
      setPendingPlan(null);
    }
  }

  return (
    <section className="tariffs" id="tariffs" aria-labelledby="tariffs-title">
      <div className="tariffs__head">
        <div>
          <p className="eyebrow">
            {ru ? "ТАРИФЫ HOLYMEDIA" : "HOLYMEDIA PLANS"}
          </p>
          <h2 id="tariffs-title">
            {ru ? "Выберите формат работы" : "Choose how you work"}
          </h2>
          <p>{ru ? "Пробный период — 14 дней." : "14-day trial period."}</p>
        </div>
        <div
          className="tariffs__switch"
          role="radiogroup"
          aria-label={ru ? "Уровень обслуживания" : "Service level"}
        >
          {(
            [
              [
                "SELF_SERVICE",
                ru ? "Самостоятельно" : "Self-service",
                ru
                  ? "Управляйте подключениями и работой сами."
                  : "Manage connections and work independently.",
              ],
              [
                "HOLYMEDIA_SUPPORT",
                ru ? "Расширенная поддержка" : "Extended support",
                ru
                  ? "Команда Holy Media помогает с регулярной работой."
                  : "Holy Media supports ongoing work.",
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={level === value}
              className={level === value ? "is-active" : ""}
              onClick={() => setLevel(value)}
            >
              <span>{label}</span>
              <small>{hint}</small>
            </button>
          ))}
        </div>
      </div>

      {subscription && <SubscriptionInfo subscription={subscription} compact />}
      {requestError && (
        <p className="tariffs__request-error" role="alert">
          {requestError}
        </p>
      )}

      <div className="tariffs__plans">
        {TARIFF_PLANS.map((plan) => {
          const planKey = plan.dbKey[level];
          const selected = currentKey === planKey;
          return (
            <article
              className={
                plan.code === "marketing"
                  ? "tariff-plan tariff-plan--featured"
                  : "tariff-plan"
              }
              key={plan.code}
            >
              <div>
                <span>{plan.direction[language]}</span>
                <h3>{plan.name[language]}</h3>
              </div>
              <strong>
                {money(plan.priceKzt[level])}
                <small>{ru ? " / мес." : " / mo."}</small>
              </strong>
              <p>
                {plan.tokens.toLocaleString("ru-RU")}{" "}
                {ru ? "AI-токенов в месяц" : "AI tokens per month"}
              </p>
              {selected ? (
                <b>{ru ? "Ваш тариф" : "Your plan"}</b>
              ) : workspaceId ? (
                <button
                  className="btn btn--secondary btn--small"
                  type="button"
                  onClick={() => {
                    setRequestSent(false);
                    setRequestedPlan(planKey);
                  }}
                >
                  {ru ? "Выбрать тариф" : "Choose plan"}
                </button>
              ) : (
                <Link
                  className="btn btn--secondary btn--small"
                  href="/auth?mode=signup"
                >
                  {ru ? "Начать пробный период" : "Start trial"}
                </Link>
              )}
            </article>
          );
        })}
      </div>

      <div className="tariffs__table-wrap">
        <table className="tariffs__table">
          <thead>
            <tr>
              <th>{ru ? "Возможности" : "Features"}</th>
              {TARIFF_PLANS.map((plan) => (
                <th key={plan.code}>{plan.name[language]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TARIFF_FEATURES.map((feature) => (
              <tr key={feature.key}>
                <th>{feature.label[language]}</th>
                {TARIFF_PLANS.map((plan) => (
                  <td key={plan.code}>{feature.values[plan.code]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="tariffs__support">
        <summary>
          {ru
            ? "Что входит в расширенную поддержку Holy Media"
            : "What Holy Media extended support includes"}
        </summary>
        <table>
          <tbody>
            {SUPPORT_FEATURES.map(([russian, english, self, supported]) => (
              <tr key={russian}>
                <th>{ru ? russian : english}</th>
                <td>{self}</td>
                <td>{supported}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {requestedPlan && (
        <div
          className="tariffs__request-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tariff-request-title"
        >
          <div>
            <h3 id="tariff-request-title">
              {ru ? "Подтвердить запрос" : "Confirm request"}
            </h3>
            <p>
              {ru
                ? "Запрос будет отправлен администратору Holy Media. Тариф не изменится до его подтверждения."
                : "The request will be sent to a Holy Media administrator. Your plan will not change until it is approved."}
            </p>
            <div className="tariffs__request-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRequestedPlan(null)}
              >
                {ru ? "Отмена" : "Cancel"}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={pendingPlan === requestedPlan}
                onClick={() => void requestPlan(requestedPlan)}
              >
                {pendingPlan === requestedPlan
                  ? ru
                    ? "Отправляем…"
                    : "Sending…"
                  : ru
                    ? "Отправить запрос"
                    : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
      {requestSent && (
        <p className="tariffs__request-confirmation" role="status">
          {ru
            ? "Запрос отправлен администратору. Текущий тариф не изменён."
            : "Your request has been sent. Your current plan has not changed."}
        </p>
      )}
    </section>
  );
}
