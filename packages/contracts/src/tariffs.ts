export type TariffLanguage = "ru" | "en";
export type TariffServiceLevel = "SELF_SERVICE" | "HOLYMEDIA_SUPPORT";

export type TariffFeature = {
  key: string;
  label: Record<TariffLanguage, string>;
  values: Record<"site" | "ads" | "seo" | "marketing", string>;
};

export type TariffPlan = {
  code: "site" | "ads" | "seo" | "marketing";
  dbKey: Record<TariffServiceLevel, string>;
  name: Record<TariffLanguage, string>;
  direction: Record<TariffLanguage, string>;
  priceKzt: Record<TariffServiceLevel, number>;
  tokens: number;
};

export const TARIFF_TRIAL_DAYS = 14;

/**
 * Internal-only V2 access grant. This is intentionally not part of
 * TARIFF_PLANS: it must never be offered by public pricing or self-service
 * billing. It is assigned only by the protected system-admin flow.
 */
export const FULL_ACCESS_LIFETIME_PLAN_KEY = "legacy_internal";
export const FULL_ACCESS_LIFETIME_GRANT = "FULL_NON_EXPIRING";

export const TARIFF_PLANS: readonly TariffPlan[] = [
  {
    code: "site",
    dbKey: {
      SELF_SERVICE: "ai_site_self",
      HOLYMEDIA_SUPPORT: "ai_site_support",
    },
    name: { ru: "AI Сайт", en: "AI Website" },
    direction: { ru: "Сайт", en: "Website" },
    priceKzt: { SELF_SERVICE: 149000, HOLYMEDIA_SUPPORT: 550000 },
    tokens: 7500,
  },
  {
    code: "ads",
    dbKey: { SELF_SERVICE: "ai_ads_self", HOLYMEDIA_SUPPORT: "ai_ads_support" },
    name: { ru: "AI Реклама", en: "AI Ads" },
    direction: { ru: "Реклама", en: "Advertising" },
    priceKzt: { SELF_SERVICE: 199000, HOLYMEDIA_SUPPORT: 550000 },
    tokens: 10000,
  },
  {
    code: "seo",
    dbKey: { SELF_SERVICE: "ai_seo_self", HOLYMEDIA_SUPPORT: "ai_seo_support" },
    name: { ru: "AI SEO", en: "AI SEO" },
    direction: { ru: "SEO", en: "SEO" },
    priceKzt: { SELF_SERVICE: 199000, HOLYMEDIA_SUPPORT: 550000 },
    tokens: 10000,
  },
  {
    code: "marketing",
    dbKey: {
      SELF_SERVICE: "ai_marketing_self",
      HOLYMEDIA_SUPPORT: "ai_marketing_support",
    },
    name: { ru: "AI Marketing", en: "AI Marketing" },
    direction: { ru: "Всё вместе", en: "All-in-one" },
    priceKzt: { SELF_SERVICE: 399000, HOLYMEDIA_SUPPORT: 790000 },
    tokens: 25000,
  },
] as const;

export const TARIFF_FEATURES: readonly TariffFeature[] = [
  [
    "telegram_agent",
    "AI-агент в Telegram",
    "AI agent in Telegram",
    "✓",
    "✓",
    "✓",
    "✓",
  ],
  [
    "team",
    "Количество сотрудников",
    "Team members",
    "Без ограничений",
    "Без ограничений",
    "Без ограничений",
    "Без ограничений",
  ],
  [
    "tokens",
    "AI-токены в месяц",
    "AI tokens per month",
    "7 500",
    "10 000",
    "10 000",
    "25 000",
  ],
  ["meta", "Meta Ads", "Meta Ads", "—", "✓", "—", "✓"],
  ["google_ads", "Google Ads", "Google Ads", "—", "✓", "—", "✓"],
  ["tiktok", "TikTok Ads", "TikTok Ads", "—", "✓", "—", "✓"],
  ["yandex", "Яндекс.Директ", "Yandex Direct", "—", "✓", "—", "✓"],
  ["analytics", "Google Analytics", "Google Analytics", "✓", "✓", "✓", "✓"],
  [
    "search_console",
    "Google Search Console",
    "Google Search Console",
    "Базово",
    "—",
    "✓",
    "✓",
  ],
  [
    "ads_dashboard",
    "Рекламный дашборд",
    "Advertising dashboard",
    "—",
    "✓",
    "—",
    "✓",
  ],
  ["seo_dashboard", "SEO-дашборд", "SEO dashboard", "—", "—", "✓", "✓"],
  ["site_analysis", "Анализ сайта", "Website analysis", "✓", "—", "✓", "✓"],
  [
    "recommendations",
    "Рекомендации AI",
    "AI recommendations",
    "✓",
    "✓",
    "✓",
    "✓",
  ],
  ["weekly", "Еженедельные отчёты", "Weekly reports", "✓", "✓", "✓", "✓"],
  ["monthly", "Ежемесячные отчёты", "Monthly reports", "✓", "✓", "✓", "✓"],
  ["daily", "Ежедневные отчёты", "Daily reports", "—", "Опция", "—", "✓"],
  [
    "quarterly",
    "Квартальные отчёты",
    "Quarterly reports",
    "—",
    "Опция",
    "Опция",
    "✓",
  ],
  [
    "ad_analysis",
    "Анализ эффективности рекламы",
    "Advertising performance analysis",
    "—",
    "✓",
    "—",
    "✓",
  ],
  [
    "ad_optimization",
    "Оптимизация рекламных кампаний",
    "Advertising campaign optimisation",
    "—",
    "✓",
    "—",
    "✓",
  ],
  [
    "search_traffic",
    "Анализ поискового трафика",
    "Search traffic analysis",
    "—",
    "—",
    "✓",
    "✓",
  ],
  [
    "seo_analysis",
    "SEO-анализ и точки роста",
    "SEO analysis and growth points",
    "Базово",
    "—",
    "✓",
    "✓",
  ],
  [
    "site_recommendations",
    "Рекомендации по улучшению сайта",
    "Website improvement recommendations",
    "✓",
    "—",
    "✓",
    "✓",
  ],
  ["tasks", "Постановка задач", "Task setting", "✓", "✓", "✓", "✓"],
  [
    "specialist_changes",
    "Внесение изменений специалистами",
    "Specialist-delivered changes",
    "—",
    "—",
    "—",
    "Опция",
  ],
  [
    "specialist_support",
    "Поддержка специалиста",
    "Specialist support",
    "Базовая",
    "Базовая",
    "Базовая",
    "Расширенная",
  ],
  [
    "onboarding",
    "Подключение и настройка",
    "Connection and setup",
    "Самостоятельно",
    "Самостоятельно",
    "Самостоятельно",
    "Мы подключаем",
  ],
].map(([key, ru, en, site, ads, seo, marketing]) => ({
  key: key!,
  label: { ru: ru!, en: en! },
  values: { site: site!, ads: ads!, seo: seo!, marketing: marketing! },
}));

export const SUPPORT_FEATURES = [
  ["AI-агент в Telegram", "AI agent in Telegram", "✓", "✓"],
  ["Неограниченное количество сотрудников", "Unlimited team members", "✓", "✓"],
  ["AI-токены", "AI tokens", "По тарифу", "Увеличенный лимит"],
  [
    "Meta / Google / TikTok / Яндекс",
    "Meta / Google / TikTok / Yandex",
    "По выбранному тарифу",
    "По выбранному тарифу",
  ],
  ["Google Analytics", "Google Analytics", "✓", "✓"],
  ["Google Search Console", "Google Search Console", "По тарифу", "✓"],
  ["Дашборды", "Dashboards", "✓", "Расширенные"],
  ["Еженедельные и ежемесячные отчёты", "Weekly and monthly reports", "✓", "✓"],
  ["Ежедневные отчёты", "Daily reports", "Опция", "✓"],
  ["Квартальные / годовые отчёты", "Quarterly / annual reports", "Опция", "✓"],
  ["AI-рекомендации", "AI recommendations", "✓", "✓"],
  ["Выполнение задач специалистами", "Specialist task delivery", "—", "✓"],
  ["Внесение изменений", "Making changes", "—", "✓"],
  [
    "Контроль рекламных кампаний",
    "Advertising campaign control",
    "Самостоятельно",
    "Holy Media",
  ],
  ["Контроль SEO-задач", "SEO task control", "Самостоятельно", "Holy Media"],
  ["Техническая поддержка", "Technical support", "Базовая", "Расширенная"],
  [
    "Настройка и подключение",
    "Setup and connection",
    "Самостоятельно",
    "Holy Media",
  ],
  ["Индивидуальные AI skills", "Custom AI skills", "—", "✓"],
  ["Приоритетное решение проблем", "Priority issue resolution", "—", "✓"],
] as const;

export function tariffPlanByKey(key: string) {
  return TARIFF_PLANS.find((plan) => Object.values(plan.dbKey).includes(key));
}

export function tariffServiceLevel(key: string): TariffServiceLevel | null {
  const plan = tariffPlanByKey(key);
  if (!plan) return null;
  return plan.dbKey.HOLYMEDIA_SUPPORT === key
    ? "HOLYMEDIA_SUPPORT"
    : "SELF_SERVICE";
}

/**
 * Customer-facing representation of a subscription key. Keep this next to the
 * tariff catalogue so support, product UI and admin never need their own
 * ad-hoc key-to-label tables.
 */
export type TariffPresentation = {
  plan: Record<TariffLanguage, string>;
  serviceLevel: Record<TariffLanguage, string> | null;
  full: Record<TariffLanguage, string>;
  kind: "catalog" | "lifetime" | "unknown";
};

const TARIFF_SERVICE_LEVEL_LABELS: Record<
  TariffServiceLevel,
  Record<TariffLanguage, string>
> = {
  SELF_SERVICE: { ru: "Самостоятельно", en: "Self-service" },
  HOLYMEDIA_SUPPORT: {
    ru: "Расширенная поддержка",
    en: "Extended support",
  },
};

const LIFETIME_PRESENTATION: TariffPresentation = {
  plan: { ru: "Полный доступ", en: "Full access" },
  serviceLevel: null,
  full: {
    ru: "Полный доступ / Бессрочно",
    en: "Full access / Lifetime",
  },
  kind: "lifetime",
};

const UNKNOWN_PRESENTATION: TariffPresentation = {
  plan: { ru: "Не определён", en: "Not specified" },
  serviceLevel: null,
  full: { ru: "Не определён", en: "Not specified" },
  kind: "unknown",
};

export function tariffPresentation(
  key: string | null | undefined,
  options?: { lifetimeAccess?: boolean },
): TariffPresentation {
  if (options?.lifetimeAccess || key === FULL_ACCESS_LIFETIME_PLAN_KEY)
    return LIFETIME_PRESENTATION;
  if (!key) return UNKNOWN_PRESENTATION;

  const plan = tariffPlanByKey(key);
  const serviceLevel = tariffServiceLevel(key);
  if (!plan || !serviceLevel) return UNKNOWN_PRESENTATION;
  const level = TARIFF_SERVICE_LEVEL_LABELS[serviceLevel];
  return {
    plan: plan.name,
    serviceLevel: level,
    full: {
      ru: `${plan.name.ru} — ${level.ru}`,
      en: `${plan.name.en} — ${level.en}`,
    },
    kind: "catalog",
  };
}
