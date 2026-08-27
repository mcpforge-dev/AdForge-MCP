"use client";

import { tariffPlanByKey, tariffServiceLevel } from "@holymedia/contracts";
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

export function subscriptionPresentation(
  subscription?: SubscriptionInfoValue | null,
) {
  const key = subscription?.plan?.key;
  const fullAccess =
    key === "legacy_internal" ||
    subscription?.metadata?.accessGrant === "FULL_NON_EXPIRING";
  const plan = key ? tariffPlanByKey(key) : undefined;
  const language = "ru" as const;
  const status = subscription?.status;
  const trialEndsAt = subscription?.trialEndsAt
    ? new Date(subscription.trialEndsAt)
    : null;
  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;
  return {
    fullAccess,
    planName: fullAccess
      ? "Полный доступ"
      : (plan?.name[language] ?? subscription?.plan?.name ?? "Тариф не выбран"),
    mode: fullAccess
      ? "Бессрочно"
      : tariffServiceLevel(key ?? "") === "HOLYMEDIA_SUPPORT"
        ? "Расширенная поддержка"
        : "Самостоятельно",
    status: fullAccess
      ? "Полный доступ"
      : status === "TRIALING"
        ? `Пробный период${daysLeft !== null ? ` · ${daysLeft} дн.` : ""}`
        : status === "ACTIVE"
          ? "Активен"
          : status === "PAST_DUE"
            ? "Требует внимания"
            : "Нет активного тарифа",
  };
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
  const key = subscription?.plan?.key;
  const fullAccess =
    key === "legacy_internal" ||
    subscription?.metadata?.accessGrant === "FULL_NON_EXPIRING";
  const plan = key ? tariffPlanByKey(key) : undefined;
  const level = tariffServiceLevel(key ?? "");
  const trialEndsAt = subscription?.trialEndsAt
    ? new Date(subscription.trialEndsAt)
    : null;
  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;
  const planName = fullAccess
    ? ru
      ? "Полный доступ"
      : "Full access"
    : (plan?.name[language] ??
      subscription?.plan?.name ??
      (ru ? "Тариф не выбран" : "No plan selected"));
  const status = fullAccess
    ? ru
      ? "Полный доступ"
      : "Full access"
    : subscription?.status === "TRIALING"
      ? ru
        ? `Пробный период${daysLeft !== null ? ` · ${daysLeft} дн.` : ""}`
        : `Trial${daysLeft !== null ? ` · ${daysLeft} days` : ""}`
      : subscription?.status === "ACTIVE"
        ? ru
          ? "Активен"
          : "Active"
        : subscription?.status === "PAST_DUE"
          ? ru
            ? "Требует внимания"
            : "Needs attention"
          : ru
            ? "Нет активного тарифа"
            : "No active plan";
  const mode = fullAccess
    ? ru
      ? "Бессрочно"
      : "Permanent"
    : level === "HOLYMEDIA_SUPPORT"
      ? ru
        ? "Расширенная поддержка"
        : "Extended support"
      : ru
        ? "Самостоятельно"
        : "Self-service";

  return (
    <section
      className={`subscription-info${compact ? " subscription-info--compact" : ""}`}
      aria-label={ru ? "Тариф и подписка" : "Plan and subscription"}
    >
      <div className="subscription-info__top">
        <span>{ru ? "Тариф и подписка" : "Plan and subscription"}</span>
        <b>{status}</b>
      </div>
      <strong>{planName}</strong>
      <p>{mode}</p>
      <dl>
        {subscription?.startsAt && (
          <div>
            <dt>{ru ? "Начало" : "Started"}</dt>
            <dd>{date(subscription.startsAt, language)}</dd>
          </div>
        )}
        {fullAccess ? (
          <div>
            <dt>{ru ? "Доступ" : "Access"}</dt>
            <dd>{ru ? "Оплата не требуется" : "No payment required"}</dd>
          </div>
        ) : (
          subscription?.status === "TRIALING" && (
            <div>
              <dt>{ru ? "До" : "Until"}</dt>
              <dd>{date(subscription.trialEndsAt, language)}</dd>
            </div>
          )
        )}
        {!fullAccess &&
          subscription?.status === "ACTIVE" &&
          subscription?.currentPeriodEnd && (
            <div>
              <dt>{ru ? "Период до" : "Period until"}</dt>
              <dd>{date(subscription.currentPeriodEnd, language)}</dd>
            </div>
          )}
      </dl>
      {onOpenTariffs && (
        <button
          type="button"
          className="secondary-button btn--small"
          onClick={onOpenTariffs}
        >
          {ru ? "Посмотреть тарифы" : "View plans"}
        </button>
      )}
    </section>
  );
}
