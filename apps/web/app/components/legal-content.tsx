"use client";

import { useEffect } from "react";
import { useLanguage } from "./language-switcher";

type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

type LegalCopy = {
  eyebrow: string;
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
  contact: string;
  site: string;
};

const privacy: Record<"ru" | "en", LegalCopy> = {
  ru: {
    eyebrow: "Правовая информация",
    title: "Политика конфиденциальности HolyMedia MCP",
    updated: "Последнее обновление: 22 июня 2026 года",
    intro: [
      "HolyMedia MCP — B2B-сервис для подключения рекламных кабинетов, просмотра рекламных данных, анализа кампаний и работы с AI-клиентами.",
      "В этой политике описано, какие данные мы обрабатываем, для чего они нужны и как мы защищаем их при работе с сайтом, кабинетом и OAuth-подключениями рекламных платформ.",
    ],
    sections: [
      {
        heading: "1. Какие данные мы обрабатываем",
        paragraphs: ["Мы можем обрабатывать следующие категории данных:"],
        items: [
          "данные аккаунта: имя, email, настройки профиля, статус аккаунта и данные сессии;",
          "данные рекламных подключений: платформы, ID и названия доступных рекламных кабинетов, а также выбранные пользователем кабинеты;",
          "рекламные данные: кампании, статусы, бюджеты, расходы, показы, клики, конверсии и основные показатели эффективности;",
          "данные авторизации, необходимые для поддержания подключений;",
          "технические данные: IP-адрес, тип браузера, диагностические события, ошибки и журналы безопасности.",
        ],
      },
      {
        heading: "2. Как мы используем данные",
        paragraphs: [
          "Мы используем данные только для работы функций HolyMedia MCP:",
        ],
        items: [
          "создания и поддержки вашего рабочего пространства;",
          "подключения рекламных платформ через OAuth;",
          "показа рекламных кабинетов, кампаний, статусов и показателей;",
          "подготовки отчётов, рекомендаций и предварительного просмотра действий;",
          "работы AI-клиентов, подключённых пользователем;",
          "обеспечения безопасности, предотвращения злоупотреблений и поддержки сервиса.",
        ],
      },
      {
        heading: "3. Данные Google и Meta",
        paragraphs: [
          "HolyMedia MCP получает данные Google Ads и Meta Ads только после явного разрешения пользователя через OAuth и использует их только для рекламной аналитики и работы с подключёнными кабинетами.",
          "Мы не продаём данные рекламных платформ и не используем их для кредитования, несвязанного профилирования или сторонней рекламы. Данные Google API обрабатываются в соответствии с Политикой пользовательских данных сервисов Google API, включая требования Limited Use.",
        ],
      },
      {
        heading: "4. Передача третьим лицам",
        paragraphs: [
          "Мы не продаём персональные или рекламные данные. Ограниченная передача возможна только инфраструктурным провайдерам, авторизованным рекламным платформам, AI-клиентам, подключённым пользователем, или в случаях, предусмотренных законом.",
        ],
      },
      {
        heading: "5. Хранение и безопасность",
        paragraphs: [
          "Мы используем HTTPS, зашифрованные OAuth-подключения, хешированные ключи доступа, изоляцию данных рабочих пространств, ограниченный доступ к production и защищённые диагностические журналы.",
          "Секреты платформ, ключи и служебные данные не публикуются и не показываются повторно после сохранения.",
        ],
      },
      {
        heading: "6. Срок хранения",
        paragraphs: [
          "Данные хранятся только столько, сколько необходимо для работы сервиса, обеспечения безопасности, выполнения требований закона и поддержки пользователей.",
        ],
      },
      {
        heading: "7. Ваши права и удаление данных",
        paragraphs: [
          "Вы можете запросить удаление аккаунта, отключение рекламных платформ, экспорт или разъяснение по своим данным через поддержку. Также вы можете отозвать доступ приложения в настройках соответствующей платформы.",
        ],
      },
      {
        heading: "8. Международная обработка",
        paragraphs: [
          "Данные могут обрабатываться на инфраструктуре за пределами страны проживания пользователя. Мы применяем разумные меры защиты в соответствии с этой политикой.",
        ],
      },
      {
        heading: "9. Изменения политики",
        paragraphs: [
          "Мы можем обновлять эту политику. Существенные изменения в обработке данных будут отражены на этой странице и, когда это требуется, потребуют нового согласия.",
        ],
      },
    ],
    contact: "10. Контакты",
    site: "Сайт",
  },
  en: {
    eyebrow: "Legal information",
    title: "HolyMedia MCP Privacy Policy",
    updated: "Last updated: June 22, 2026",
    intro: [
      "HolyMedia MCP is a B2B service for connecting advertising accounts, viewing advertising data, analyzing campaigns, and working with AI clients.",
      "This policy explains what data we process, why we need it, and how we protect it when you use the website, workspace, and OAuth connections to advertising platforms.",
    ],
    sections: [
      {
        heading: "1. Data we collect",
        paragraphs: ["We may process the following categories of data:"],
        items: [
          "account data: name, email, profile settings, account status, and session data;",
          "advertising connection data: platforms, IDs and names of available advertising accounts, and accounts selected by the user;",
          "advertising data: campaigns, statuses, budgets, spend, impressions, clicks, conversions, and core performance metrics;",
          "authorization data needed to maintain connections;",
          "technical data: IP address, browser type, diagnostic events, errors, and security logs.",
        ],
      },
      {
        heading: "2. How we use data",
        paragraphs: ["We use data only to provide HolyMedia MCP features:"],
        items: [
          "creating and maintaining your workspace;",
          "connecting advertising platforms through OAuth;",
          "displaying advertising accounts, campaigns, statuses, and metrics;",
          "preparing reports, recommendations, and action previews;",
          "serving AI clients connected by the user;",
          "providing security, abuse prevention, and service support.",
        ],
      },
      {
        heading: "3. Google and Meta data",
        paragraphs: [
          "HolyMedia MCP receives Google Ads and Meta Ads data only after the user's explicit OAuth permission and uses it only for advertising analytics and work with connected accounts.",
          "We do not sell advertising platform data or use it for lending, unrelated profiling, or third-party advertising. Google API data is handled in accordance with the Google API Services User Data Policy, including Limited Use requirements.",
        ],
      },
      {
        heading: "4. Sharing with third parties",
        paragraphs: [
          "We do not sell personal or advertising data. Limited sharing may occur only with infrastructure providers, authorized advertising platforms, AI clients connected by the user, or where legally required.",
        ],
      },
      {
        heading: "5. Storage and security",
        paragraphs: [
          "We use HTTPS, encrypted OAuth connections, hashed access keys, workspace isolation, restricted production access, and secure diagnostic logs.",
          "Platform secrets, keys, and service data are never published or shown again after they are saved.",
        ],
      },
      {
        heading: "6. Retention",
        paragraphs: [
          "Data is retained only as long as necessary to provide the service, maintain security, meet legal requirements, and support users.",
        ],
      },
      {
        heading: "7. Your rights and deletion",
        paragraphs: [
          "You may request account deletion, disconnection of advertising platforms, export, or clarification of your data by contacting support. You can also revoke application access in the settings of the relevant platform.",
        ],
      },
      {
        heading: "8. International processing",
        paragraphs: [
          "Data may be processed on infrastructure outside the user's country of residence. We apply reasonable safeguards consistent with this policy.",
        ],
      },
      {
        heading: "9. Policy changes",
        paragraphs: [
          "We may update this policy. Material changes to data processing will be reflected on this page and, where required, will require renewed consent.",
        ],
      },
    ],
    contact: "10. Contact",
    site: "Website",
  },
};

const terms: Record<"ru" | "en", LegalCopy> = {
  ru: {
    eyebrow: "Правовая информация",
    title: "Условия использования HolyMedia MCP",
    updated: "Последнее обновление: 22 июня 2026 года",
    intro: [
      "Эти условия регулируют доступ к HolyMedia MCP: сайту, рабочему пространству, подключениям рекламных платформ, аналитике и связанным AI-функциям.",
      "Используя HolyMedia MCP, вы соглашаетесь с этими условиями.",
    ],
    sections: [
      {
        heading: "1. Описание сервиса",
        paragraphs: [
          "HolyMedia MCP позволяет подключать рекламные кабинеты, просматривать кампании, статусы и основные показатели, готовить отчёты и задавать вопросы через совместимые AI-клиенты.",
          "Изменения в рекламных кабинетах не выполняются без отдельного подтверждения.",
        ],
      },
      {
        heading: "2. Право на использование",
        paragraphs: [
          "У вас должны быть законные полномочия на подключение и просмотр рекламных кабинетов, которые вы авторизуете в HolyMedia MCP.",
        ],
      },
      {
        heading: "3. Аккаунт пользователя",
        paragraphs: [
          "Вы отвечаете за безопасность email, пароля, ключей доступа и подключений. При подозрении на компрометацию смените пароль, отзовите ключ или обратитесь в поддержку.",
        ],
      },
      {
        heading: "4. Подключения рекламных платформ",
        paragraphs: [
          "Подключая платформу, вы разрешаете HolyMedia MCP получать данные в пределах разрешений, показанных на экране OAuth. Вы можете отозвать доступ в HolyMedia MCP или настройках платформы.",
        ],
      },
      {
        heading: "5. AI-клиенты",
        paragraphs: [
          "Вы самостоятельно выбираете AI-клиент и предоставляемый ему доступ. Использование Claude, ChatGPT, Codex и других сторонних клиентов также регулируется их собственными условиями.",
        ],
      },
      {
        heading: "6. Допустимое использование",
        paragraphs: [
          "Нельзя использовать сервис для незаконной деятельности, доступа к чужим кабинетам, обхода авторизации или ограничений, перегрузки сервиса, загрузки вредоносного кода или нарушения правил рекламных платформ.",
        ],
      },
      {
        heading: "7. Безопасность рекламных действий",
        paragraphs: [
          "Рекомендации и отчёты не гарантируют рекламный результат и должны быть проверены вами. Любое доступное изменение рекламного объекта требует предварительного просмотра и явного подтверждения.",
        ],
      },
      {
        heading: "8. Сторонние платформы",
        paragraphs: [
          "Мы не отвечаем за сбои, API-лимиты, изменения правил, блокировки или проверки со стороны Google, Meta, TikTok, Яндекс и других платформ.",
        ],
      },
      {
        heading: "9. Доступность и изменения",
        paragraphs: [
          "Функции могут обновляться или временно ограничиваться для повышения безопасности и качества сервиса.",
        ],
      },
      {
        heading: "10. Интеллектуальная собственность",
        paragraphs: [
          "Интерфейс, код, документация, бренд и материалы HolyMedia MCP принадлежат соответствующим правообладателям и не могут распространяться без письменного разрешения.",
        ],
      },
      {
        heading: "11. Отказ от гарантий",
        paragraphs: [
          "Сервис предоставляется «как есть» и «по мере доступности». Мы не гарантируем бесперебойную работу или конкретный рекламный результат.",
        ],
      },
      {
        heading: "12. Ограничение ответственности",
        paragraphs: [
          "В максимальной степени, разрешённой законом, HolyMedia MCP не несёт ответственности за косвенные убытки, упущенную выгоду, рекламные расходы или действия сторонних платформ.",
        ],
      },
      {
        heading: "13. Приостановка доступа",
        paragraphs: [
          "Мы можем ограничить доступ при нарушении условий, угрозе безопасности, злоупотреблении сервисом или требованиях закона.",
        ],
      },
      {
        heading: "14. Изменения условий",
        paragraphs: [
          "Мы можем обновлять эти условия. Продолжение использования после обновления означает принятие новой версии.",
        ],
      },
    ],
    contact: "15. Контакты",
    site: "Сайт",
  },
  en: {
    eyebrow: "Legal information",
    title: "HolyMedia MCP Terms of Use",
    updated: "Last updated: June 22, 2026",
    intro: [
      "These terms govern access to HolyMedia MCP: the website, workspace, advertising platform connections, analytics, and related AI features.",
      "By using HolyMedia MCP, you agree to these terms.",
    ],
    sections: [
      {
        heading: "1. Service description",
        paragraphs: [
          "HolyMedia MCP lets you connect advertising accounts, view campaigns, statuses, and core metrics, prepare reports, and ask questions through compatible AI clients.",
          "Real changes in advertising accounts are not performed without separate confirmation.",
        ],
      },
      {
        heading: "2. Right to use",
        paragraphs: [
          "You must have legal authority to connect and view the advertising accounts you authorize in HolyMedia MCP.",
        ],
      },
      {
        heading: "3. User account",
        paragraphs: [
          "You are responsible for the security of your email, password, access keys, and connections. If you suspect exposure, change your password, revoke the key, or contact support.",
        ],
      },
      {
        heading: "4. Advertising platform connections",
        paragraphs: [
          "By connecting a platform, you allow HolyMedia MCP to receive data within the permissions shown on the OAuth consent screen. You can revoke access in HolyMedia MCP or the platform settings.",
        ],
      },
      {
        heading: "5. AI clients",
        paragraphs: [
          "You choose the AI client and the access you provide to it. Your use of Claude, ChatGPT, Codex, and other third-party clients is also governed by their own terms.",
        ],
      },
      {
        heading: "6. Acceptable use",
        paragraphs: [
          "You may not use the service for illegal activity, access to accounts belonging to others, bypassing authorization or limits, overloading the service, uploading malicious code, or violating advertising platform rules.",
        ],
      },
      {
        heading: "7. Advertising action safety",
        paragraphs: [
          "Recommendations and reports do not guarantee advertising results and must be reviewed by you. Any available advertising object change requires a preview and explicit confirmation.",
        ],
      },
      {
        heading: "8. Third-party platforms",
        paragraphs: [
          "We are not responsible for outages, API limits, rule changes, suspensions, or reviews by Google, Meta, TikTok, Yandex, or other platforms.",
        ],
      },
      {
        heading: "9. Availability and changes",
        paragraphs: [
          "Features may be updated or temporarily limited to improve security and service quality.",
        ],
      },
      {
        heading: "10. Intellectual property",
        paragraphs: [
          "The HolyMedia MCP interface, code, documentation, brand, and materials belong to their rights holders and may not be distributed without written permission.",
        ],
      },
      {
        heading: "11. Disclaimer of warranties",
        paragraphs: [
          "The service is provided as is and as available. We do not guarantee uninterrupted operation or specific advertising results.",
        ],
      },
      {
        heading: "12. Limitation of liability",
        paragraphs: [
          "To the maximum extent permitted by law, HolyMedia MCP is not liable for indirect losses, lost profits, advertising expenses, or actions of third-party platforms.",
        ],
      },
      {
        heading: "13. Suspension",
        paragraphs: [
          "We may restrict access for a breach of these terms, a security threat, abuse of the service, or legal requirements.",
        ],
      },
      {
        heading: "14. Changes to these terms",
        paragraphs: [
          "We may update these terms. Continued use after an update means you accept the new version.",
        ],
      },
    ],
    contact: "15. Contact",
    site: "Website",
  },
};

export function LegalContent({ kind }: { kind: "privacy" | "terms" }) {
  const language = useLanguage();
  const copy = (kind === "privacy" ? privacy : terms)[language];

  useEffect(() => {
    document.title = `${copy.title} | HolyMedia MCP`;
  }, [copy.title]);

  return (
    <article className="legal-card" data-language-static>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p className="legal-updated">{copy.updated}</p>
      {copy.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {copy.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.items && (
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <section>
        <h2>{copy.contact}</h2>
        <p>
          <strong>HolyMedia MCP</strong>
          <br />
          Email: <a href="mailto:mcp@holymedia.kz">mcp@holymedia.kz</a>
          <br />
          {copy.site}: <a href="https://mcp.holymedia.kz">mcp.holymedia.kz</a>
        </p>
      </section>
    </article>
  );
}
