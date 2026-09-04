"use client";

import {
  FULL_ACCESS_LIFETIME_GRANT,
  FULL_ACCESS_LIFETIME_PLAN_KEY,
  tariffPresentation,
  tariffServiceLevel,
} from "@holymedia/contracts";
import { useLanguage } from "./language-switcher";

export type SubscriptionInfoValue = {
  status?: string;
  startsAt?: string | null;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  metadata?: Record<string, unknown> | null;
  plan?: { key?: string; name?: string } | null;
};

function date(value?: string | null, language = "ru") {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function getPresentation(
  subscription: SubscriptionInfoValue | null | undefined,
  language: "ru" | "en",
) {
  const key = subscription?.plan?.key;
  const fullAccess =
    key === FULL_ACCESS_LIFETIME_PLAN_KEY ||
    subscription?.metadata?.accessGrant === FULL_ACCESS_LIFETIME_GRANT;
  const plan = tariffPresentation(key, { lifetimeAccess: fullAccess });
  const level = tariffServiceLevel(key ?? "");
  const status = subscription?.status;
  const trialEndsAt = subscription?.trialEndsAt
    ? new Date(subscription.trialEndsAt)
    : null;
  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;
  const ru = language === "ru";

  return {
    fullAccess,
    planName: plan.plan[language],
    mode: fullAccess
      ? ru
        ? "Бессрочно"
        : "Lifetime"
      : level === "HOLYMEDIA_SUPPORT"
        ? ru
          ? "Расширенная поддержка"
          : "Extended support"
        : ru
          ? "Самостоятельно"
          : "Self-service",
    status: fullAccess
      ? ru
        ? "Полный доступ"
        : "Full access"
      : status === "TRIALING"
        ? ru
          ? `Пробный период${daysLeft !== null ? ` · ${daysLeft} дн.` : ""}`
          : `Trial${daysLeft !== null ? ` · ${daysLeft} days` : ""}`
        : status === "ACTIVE"
          ? ru
            ? "Активен"
            : "Active"
          : status === "PAST_DUE"
            ? ru
              ? "Требует внимания"
              : "Needs attention"
            : ru
              ? "Нет активного тарифа"
              : "No active plan",
  };
}

export function subscriptionPresentation(
  subscription?: SubscriptionInfoValue | null,
) {
  return getPresentation(subscription, "ru");
}

export function SubscriptionInfo({
  subscription,
  onOpenTariffs,
  compact = false,
}: {
  subscription?: SubscriptionInfoValue | null;
  onOpenTariffs?: () => void;
  compact?: boolean;
}) {
  const language = useLanguage();
  const ru = language === "ru";
  const presentation = getPresentation(subscription, language);
  const endsAt =
    subscription?.status === "TRIALING"
      ? subscription.trialEndsAt
      : subscription?.currentPeriodEnd;

  return (
    <section
      className={`subscription-info${compact ? " subscription-info--compact" : ""}`}
      aria-label={ru ? "Тариф и подписка" : "Plan and subscription"}
    >
      <div className="subscription-info__top">
        <span>{ru ? "Тариф и подписка" : "Plan and subscription"}</span>
        <b>{presentation.status}</b>
      </div>
      <strong>{presentation.planName}</strong>
      <p className="subscription-info__level">
        <span>{ru ? "Уровень" : "Service level"}</span>
        {presentation.mode}
      </p>
      <dl>
        {subscription?.startsAt && (
          <div>
            <dt>{ru ? "Начало" : "Started"}</dt>
            <dd>{date(subscription.startsAt, language)}</dd>
          </div>
        )}
        {presentation.fullAccess ? (
          <>
            <div>
              <dt>{ru ? "Доступ" : "Access"}</dt>
              <dd>{ru ? "Бессрочно" : "Lifetime"}</dd>
            </div>
            <div>
              <dt>{ru ? "Оплата" : "Payment"}</dt>
              <dd>{ru ? "Оплата не требуется" : "No payment required"}</dd>
            </div>
          </>
        ) : (
          endsAt && (
            <div>
              <dt>
                {subscription?.status === "TRIALING"
                  ? ru
                    ? "Пробный период до"
                    : "Trial until"
                  : ru
                    ? "Подписка до"
                    : "Subscription until"}
              </dt>
              <dd>{date(endsAt, language)}</dd>
            </div>
          )
        )}
      </dl>
      {onOpenTariffs && (
        <div className="subscription-info__footer">
          <button
            type="button"
            className="secondary-button btn--small"
            onClick={onOpenTariffs}
          >
            {ru ? "Посмотреть тарифы" : "View plans"}
          </button>
          {!compact && (
            <p>
              {ru
                ? "Все подробности о тарифе и доступе доступны в разделе «Тарифы»."
                : "All plan and access details are available in the Plans section."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
