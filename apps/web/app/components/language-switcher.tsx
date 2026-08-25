"use client";

import { useEffect } from "react";

type Language = "en" | "ru";

const STORAGE_KEY = "holymedia-language";
const PAIRS: Array<[string, string]> = [
  ["Рекламная аналитика и MCP", "Advertising analytics and MCP"],
  ["HolyMedia MCP", "HolyMedia MCP"],
  ["Как это работает", "How it works"],
  ["Войти", "Sign in"],
  ["Создать аккаунт", "Create account"],
  ["Регистрация", "Sign up"],
  ["Вся ваша реклама — в одном AI-чате", "All your advertising in one AI chat"],
  ["Ваш AI-клиент", "Your AI client"],
  [
    "Какие кампании активны и сколько мы потратили за неделю?",
    "Which campaigns are active and how much did we spend this week?",
  ],
  [
    "Активны 3 кампании, расходы за 7 дней — 412 500 ₸.",
    "3 campaigns are active; spend over 7 days is 412,500 KZT.",
  ],
  ["Лидогенерация · Meta Ads", "Lead generation · Meta Ads"],
  ["Поиск · Google Ads", "Search · Google Ads"],
  ["Ретаргетинг · Яндекс Директ", "Retargeting · Yandex Direct"],
  ["Демонстрационные данные · только просмотр", "Demo data · read-only"],
  [
    "Данные из ваших подключённых кабинетов · только просмотр",
    "Data from your connected accounts · read-only",
  ],
  ["Три шага до первого ответа", "Three steps to your first answer"],
  [
    "Подключение проходит через официальный вход рекламной платформы.",
    "Connect through the advertising platform's official authorization flow.",
  ],
  [
    "Настройка занимает один вечер и не требует разработчика.",
    "Setup takes one evening and requires no developer.",
  ],
  ["Подключите платформу", "Connect a platform"],
  [
    "Войдите через Google, Meta, TikTok или Яндекс.",
    "Sign in with Google, Meta, TikTok, or Yandex.",
  ],
  ["Выберите кабинеты", "Choose accounts"],
  [
    "Отметьте аккаунты, которые будут доступны AI-клиенту.",
    "Select the accounts your AI client can access.",
  ],
  ["Подключите MCP", "Connect MCP"],
  [
    "Скопируйте адрес и следуйте инструкции для вашего клиента.",
    "Copy the URL and follow the instructions for your client.",
  ],
  ["Что можно узнать", "What you can learn"],
  [
    "AI видит только выбранные вами рекламные кабинеты.",
    "AI can see only the advertising accounts you select.",
  ],
  [
    "какие кампании активны и где есть проблемы;",
    "which campaigns are active and where problems exist;",
  ],
  [
    "сколько потрачено за выбранный период;",
    "how much was spent during the selected period;",
  ],
  [
    "как изменились показы, клики и конверсии;",
    "how impressions, clicks, and conversions changed;",
  ],
  ["какая кампания потратила больше всего.", "which campaign spent the most."],
  [
    "Какие рекламные кабинеты подключены?",
    "Which advertising accounts are connected?",
  ],
  ["Какие кампании сейчас активны?", "Which campaigns are active right now?"],
  ["Покажи расходы за последние 7 дней", "Show spend for the last 7 days"],
  [
    "Сравни текущий период с предыдущим",
    "Compare the current period with the previous one",
  ],
  ["Безопасность", "Security"],
  ["Изменения — только после подтверждения", "Changes require your approval"],
  [
    "По умолчанию HolyMedia MCP только читает данные. Любое доступное изменение сначала показывает предварительный результат и ждёт вашего подтверждения.",
    "HolyMedia MCP is read-only by default. Any available change is previewed first and waits for your approval.",
  ],
  ["Только выбранные кабинеты", "Only selected accounts"],
  ["Доступ ограничен вашим аккаунтом.", "Access is limited to your account."],
  ["Без передачи паролей", "No password sharing"],
  ["Подключение через официальный OAuth.", "Connection uses official OAuth."],
  ["Контроль действий", "Action control"],
  [
    "Без подтверждения ничего не меняется.",
    "Nothing changes without approval.",
  ],
  ["Подключите первый кабинет", "Connect your first account"],
  [
    "Создайте аккаунт и выберите рекламную платформу.",
    "Create an account and choose an advertising platform.",
  ],
  [
    "HolyMedia MCP — продукт агентства HolyMedia.",
    "HolyMedia MCP is a HolyMedia agency product.",
  ],
  ["Политика конфиденциальности", "Privacy policy"],
  ["Условия использования", "Terms of use"],
  ["← Вернуться на главную", "← Back to home"],
  [
    "Войдите, чтобы открыть рекламные кабинеты.",
    "Sign in to open your advertising accounts.",
  ],
  ["Создайте аккаунт HolyMedia MCP.", "Create your HolyMedia MCP account."],
  [
    "Укажите email, который использовали при регистрации.",
    "Enter the email you used to register.",
  ],
  ["Войти через Google", "Continue with Google"],
  ["Имя", "Name"],
  ["Email", "Email"],
  ["Пароль", "Password"],
  ["Ваше имя", "Your name"],
  ["Ваш пароль", "Your password"],
  ["Минимум 12 символов", "At least 12 characters"],
  ["Забыли пароль?", "Forgot password?"],
  ["Подождите…", "Please wait…"],
  ["Зарегистрироваться", "Create account"],
  ["Отправить ссылку", "Send link"],
  ["Новый аккаунт", "New account"],
  ["Восстановление пароля", "Password recovery"],
  [
    "Если такой аккаунт есть, мы отправили письмо со ссылкой для сброса пароля.",
    "If an account exists, we sent an email with a password reset link.",
  ],
  ["Обзор", "Overview"],
  ["Подключения", "Connections"],
  ["AI-клиент", "AI client"],
  ["Отчёты", "Reports"],
  ["Анализ сайта", "Website audit"],
  ["SEO", "SEO"],
  ["Тарифы", "Plans"],
  ["Скоро", "Soon"],
  ["Профиль", "Profile"],
  ["Выйти", "Sign out"],
  ["Личный кабинет", "Workspace"],
  ["Реклама в вашем AI-чате", "Advertising in your AI chat"],
  [
    "Подключите рекламные платформы, выберите кабинеты и задавайте вопросы о кампаниях обычными словами.",
    "Connect advertising platforms, select accounts, and ask about campaigns in plain language.",
  ],
  ["Подключить платформу", "Connect platform"],
  ["Подключить AI-клиент", "Connect AI client"],
  ["Платформы", "Platforms"],
  ["Кабинеты", "Accounts"],
  ["подключено", "connected"],
  ["выбрано", "selected"],
  ["Готов", "Ready"],
  ["ключ доступа", "access key"],
  ["за выбранный период", "for the selected period"],
  ["Как начать", "How to start"],
  ["Официальный OAuth", "Official OAuth"],
  [
    "Отметьте аккаунты, с которыми хотите работать.",
    "Select the accounts you want to work with.",
  ],
  [
    "Скопируйте MCP URL и следуйте инструкции.",
    "Copy the MCP URL and follow the instructions.",
  ],
  ["Рекламные платформы", "Advertising platforms"],
  [
    "Подключите платформу и выберите кабинеты для AI-клиента.",
    "Connect a platform and select accounts for your AI client.",
  ],
  ["Подключено", "Connected"],
  ["Нужно проверить", "Needs review"],
  ["Нужно войти снова", "Reconnect required"],
  ["Не подключено", "Not connected"],
  ["кабинетов", "accounts"],
  ["Кабинеты ещё не найдены", "No accounts found yet"],
  [
    "Подключите платформу заново, чтобы восстановить доступ к кабинетам.",
    "Reconnect the platform to restore access to the accounts.",
  ],
  ["Скрыть кабинеты", "Hide accounts"],
  ["Посмотреть кабинеты", "View accounts"],
  ["Обновить", "Refresh"],
  ["Подключить заново", "Reconnect"],
  ["Отключить", "Disconnect"],
  ["Выберите кабинеты", "Select accounts"],
  ["Выбрать все", "Select all"],
  ["Снять все", "Clear all"],
  ["Доступен", "Available"],
  ["Проверьте статус в платформе", "Check the status in the platform"],
  ["Кабинеты пока не найдены.", "No accounts found yet."],
  ["Найти кабинеты", "Find accounts"],
  ["Сохраняем…", "Saving…"],
  ["Сохранить выбор", "Save selection"],
  ["Платформа ещё не подключена.", "This platform is not connected yet."],
  ["Подключить", "Connect"],
  ["Нужна помощь с подключением Meta?", "Need help connecting Meta?"],
  ["Подключите HolyMedia MCP", "Connect HolyMedia MCP"],
  [
    "Скопируйте адрес, создайте личный ключ и выберите инструкцию.",
    "Copy the URL, create a personal key, and choose an instruction.",
  ],
  ["Выберите AI-клиент", "Choose an AI client"],
  ["Проверяем данные…", "Checking data…"],
  ["Скачать отчёт", "Download report"],
  ["Собрать отчёт", "Build report"],
  [
    "В отчёт попадут только данные выбранного кабинета и периода.",
    "The report includes only data from the selected account and period.",
  ],
  ["Рекламный кабинет", "Advertising account"],
  ["Период", "Period"],
  ["Формат", "Format"],
  ["Выберите кабинет", "Select an account"],
  ["Последние 7 дней", "Last 7 days"],
  ["Последние 14 дней", "Last 14 days"],
  ["Последние 30 дней", "Last 30 days"],
  ["Последние 90 дней", "Last 90 days"],
  ["Word (.docx)", "Word (.docx)"],
  ["PowerPoint (.pptx)", "PowerPoint (.pptx)"],
  ["Нет данных", "No data"],
  ["Реальные данные", "Live data"],
  ["Данные недоступны", "Data unavailable"],
  ["Расход", "Spend"],
  ["Показы", "Impressions"],
  ["Клики", "Clicks"],
  ["Конверсии", "Conversions"],
  [
    "В документ попадут показатели, сравнение периодов, кампании и выводы только из этого источника.",
    "The document contains metrics, period comparison, campaigns, and findings from this source only.",
  ],
  [
    "Для отчёта нужен подключённый и выбранный кабинет Meta Ads или Google Ads.",
    "Select a connected Meta Ads or Google Ads account to build a report.",
  ],
  ["Перейти к подключениям", "Go to connections"],
  ["Проверяем выбранный кабинет", "Checking the selected account"],
  ["Выберите кабинет и период", "Select an account and period"],
  [
    "Обложка · KPI · сравнение · кампании · выводы",
    "Cover · KPIs · comparison · campaigns · findings",
  ],
  ["Анализ сайта", "Website audit"],
  ["Адрес сайта", "Website URL"],
  ["Глубина проверки", "Audit depth"],
  ["Быстрая", "Quick"],
  ["Полный анализ", "Full"],
  ["Проанализировать сайт", "Analyze website"],
  ["Загружаем профиль...", "Loading profile..."],
  ["Сохранить профиль", "Save profile"],
  ["Сменить пароль", "Change password"],
  ["Сохранить новый пароль", "Save new password"],
  ["Сохранить", "Save"],
  ["Закрыть сообщение", "Close message"],
  ["Отключить платформу?", "Disconnect platform?"],
  [
    "Реальные изменения не выполняются без отдельного подтверждения.",
    "Real changes are not executed without separate approval.",
  ],
];

const translations = new Map(PAIRS);
const orderedPairs = [...PAIRS].sort(
  (left, right) => right[0].length - left[0].length,
);
const originals = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Record<string, string>>();
let activeLanguage: Language = "en";
let applyingLanguage = false;

function translate(value: string, language: Language): string {
  if (language === "ru") return value;
  const exact = translations.get(value);
  if (exact) return exact;
  return orderedPairs.reduce(
    (current, [source, target]) => current.split(source).join(target),
    value,
  );
}

function isUiNode(node: Node): boolean {
  const parent = node.parentElement;
  return Boolean(
    parent?.closest("[data-language-switcher], script, style, noscript"),
  );
}

function applyLanguage(language: Language): void {
  if (applyingLanguage) return;
  applyingLanguage = true;
  try {
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    document.querySelectorAll("[data-language-switcher]").forEach((root) => {
      root
        .querySelectorAll<HTMLButtonElement>("button[data-language]")
        .forEach((button) => {
          const active = button.dataset.language === language;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
    });
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE && !isUiNode(node))
        textNodes.push(node as Text);
    }
    textNodes.forEach((textNode) => {
      const current = textNode.nodeValue ?? "";
      const stored = originals.get(textNode);
      const base =
        stored === undefined ||
        (/[А-Яа-яЁё]/.test(current) && current !== translate(stored, "en"))
          ? current
          : stored;
      originals.set(textNode, base ?? current);
      textNode.nodeValue = translate(base ?? current, language);
    });
    document
      .querySelectorAll<HTMLElement>("[placeholder], [title], [aria-label]")
      .forEach((element) => {
        const saved = originalAttributes.get(element) ?? {};
        (["placeholder", "title", "aria-label"] as const).forEach(
          (attribute) => {
            const current = element.getAttribute(attribute);
            if (!current) return;
            const base =
              saved[attribute] === undefined || /[А-Яа-яЁё]/.test(current)
                ? current
                : saved[attribute];
            saved[attribute] = base;
            element.setAttribute(attribute, translate(base, language));
          },
        );
        originalAttributes.set(element, saved);
      });
    window.localStorage.setItem(STORAGE_KEY, language);
  } finally {
    applyingLanguage = false;
  }
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    activeLanguage = saved === "ru" ? "ru" : "en";
    const apply = () => applyLanguage(activeLanguage);
    const observer = new MutationObserver(() => apply());
    apply();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);

  function select(language: Language) {
    activeLanguage = language;
    applyLanguage(language);
  }

  return (
    <div
      className={
        compact
          ? "language-switcher language-switcher--compact"
          : "language-switcher"
      }
      data-language-switcher
    >
      <button
        type="button"
        data-language="en"
        aria-label="English"
        onClick={() => select("en")}
      >
        EN
      </button>
      <button
        type="button"
        data-language="ru"
        aria-label="Русский"
        onClick={() => select("ru")}
      >
        RU
      </button>
    </div>
  );
}
