"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SUPPORT_FEATURES,
  TARIFF_FEATURES,
  TARIFF_PLANS,
  TARIFF_TRIAL_DAYS,
  type TariffServiceLevel,
} from "@holymedia/contracts";
import { useLanguage } from "./language-switcher";

type Subscription = {
  status?: string;
  trialEndsAt?: string | null;
  plan?: { key?: string } | null;
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₸";
}

export function TariffCatalog({
  subscription,
}: {
  subscription?: Subscription | null;
}) {
  const language = useLanguage();
  const [level, setLevel] = useState<TariffServiceLevel>("SELF_SERVICE");
  const ru = language === "ru";
  const currentKey = subscription?.plan?.key;
  const trialEnds = subscription?.trialEndsAt
    ? new Date(subscription.trialEndsAt)
    : null;
  const days = trialEnds
    ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86_400_000))
    : null;
  const status =
    subscription?.status === "TRIALING" && days === 0
      ? "EXPIRED"
      : subscription?.status;

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
          <p>
            {ru
              ? `Все тарифы начинаются с ${TARIFF_TRIAL_DAYS} дней бесплатно.`
              : `Every plan starts with ${TARIFF_TRIAL_DAYS} days free.`}
          </p>
        </div>
        <div
          className="tariffs__switch"
          role="group"
          aria-label={ru ? "Уровень обслуживания" : "Service level"}
        >
          <button
            type="button"
            className={level === "SELF_SERVICE" ? "is-active" : ""}
            onClick={() => setLevel("SELF_SERVICE")}
          >
            {ru ? "Самостоятельно" : "Self-service"}
          </button>
          <button
            type="button"
            className={level === "HOLYMEDIA_SUPPORT" ? "is-active" : ""}
            onClick={() => setLevel("HOLYMEDIA_SUPPORT")}
          >
            {ru ? "С поддержкой Holy Media" : "With Holy Media support"}
          </button>
        </div>
      </div>

      {subscription && (
        <div className="tariffs__current" role="status">
          <strong>
            {status === "TRIALING"
              ? ru
                ? "Пробный период"
                : "Free trial"
              : status === "EXPIRED"
                ? ru
                  ? "Пробный период завершён"
                  : "Free trial ended"
                : status === "ACTIVE"
                  ? ru
                    ? "Ваш тариф активен"
                    : "Your plan is active"
                  : ru
                    ? "Текущий статус доступа"
                    : "Current access status"}
          </strong>
          {currentKey && (
            <span>
              {TARIFF_PLANS.find((item) =>
                Object.values(item.dbKey).includes(currentKey),
              )?.name[language] ?? (ru ? "Сохранённый тариф" : "Saved plan")}
            </span>
          )}
          {status === "TRIALING" && days !== null && (
            <span>
              {ru ? `Осталось дней: ${days}` : `${days} days remaining`}
            </span>
          )}
        </div>
      )}

      <div className="tariffs__plans">
        {TARIFF_PLANS.map((plan) => {
          const selected = currentKey === plan.dbKey[level];
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
              ) : (
                <Link
                  className="btn btn--secondary btn--small"
                  href="/auth?mode=signup"
                >
                  {ru ? "Начать бесплатно" : "Start free"}
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
    </section>
  );
}
