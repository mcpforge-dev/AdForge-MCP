import Link from "next/link";

const baseUrl =
  process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "https://mcp.holymedia.kz";

export default function PublicHomePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "HolyMedia MCP",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: baseUrl,
    description: "Подключите рекламные кабинеты к Claude, ChatGPT или Codex.",
    publisher: {
      "@type": "Organization",
      name: "HolyMedia",
      url: "https://holymedia.kz",
    },
  };

  return (
    <main className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <header className="site-header">
        <Link className="site-brand" href="/" aria-label="HolyMedia MCP">
          <span className="logo-dot" aria-hidden="true" />
          HolyMedia MCP
        </Link>
        <nav className="site-nav" aria-label="Навигация">
          <a href="#steps">Как это работает</a>
          <Link className="btn btn--secondary btn--small" href="/auth">
            Войти
          </Link>
          <Link
            className="btn btn--primary btn--small"
            href="/auth?mode=signup"
          >
            Создать аккаунт
          </Link>
        </nav>
      </header>
      <div className="landing-main">
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">Рекламная аналитика и MCP</p>
            <h1>Вся ваша реклама — в одном AI-чате</h1>
            <p>
              HolyMedia MCP подключает Meta, Google, TikTok и Яндекс Директ к
              Claude, ChatGPT или Codex. Спрашивайте о кампаниях, расходах и
              статусах обычными словами.
            </p>
            <div className="hero__actions">
              <Link className="btn btn--primary" href="/auth?mode=signup">
                Создать аккаунт
              </Link>
              <Link className="btn btn--secondary" href="/auth">
                Войти
              </Link>
            </div>
          </div>
          <div className="hero-chat" aria-label="Пример ответа AI">
            <div className="hero-chat__title">
              <span>Ваш AI-клиент</span>
              <span>Claude · ChatGPT · Codex</span>
            </div>
            <div className="hero-chat__q">
              Какие кампании активны и сколько мы потратили за неделю?
            </div>
            <div className="hero-chat__a">
              <strong>
                Активны 3 кампании, расходы за 7 дней — 412 500 ₸.
              </strong>
              <span className="hero-chat__row">
                <span>Лидогенерация · Meta Ads</span>
                <b>184 300 ₸</b>
              </span>
              <span className="hero-chat__row">
                <span>Поиск · Google Ads</span>
                <b>141 900 ₸</b>
              </span>
              <span className="hero-chat__row">
                <span>Ретаргетинг · Яндекс Директ</span>
                <b>86 300 ₸</b>
              </span>
              <span className="hero-chat__src">
                Данные из подключённых кабинетов · только просмотр
              </span>
            </div>
          </div>
        </section>
        <section id="steps" className="how" aria-labelledby="steps-title">
          <h2 id="steps-title">Три шага до первого ответа</h2>
          <p className="how__intro">
            Настройка занимает один вечер и не требует разработчика.
          </p>
          <ol className="how-steps">
            <li className="how-step">
              <div className="how-step__num">1</div>
              <div className="how-step__body">
                <h3>Подключите рекламные кабинеты</h3>
                <p>
                  Официальный вход платформы, без передачи паролей HolyMedia.
                </p>
              </div>
            </li>
            <li className="how-arrow" aria-hidden="true">
              →
            </li>
            <li className="how-step">
              <div className="how-step__num">2</div>
              <div className="how-step__body">
                <h3>Выберите нужные аккаунты</h3>
                <p>
                  Отметьте кабинеты, которые можно использовать в вашем
                  AI-клиенте.
                </p>
              </div>
            </li>
            <li className="how-arrow" aria-hidden="true">
              →
            </li>
            <li className="how-step">
              <div className="how-step__num">3</div>
              <div className="how-step__body">
                <h3>Задавайте вопросы</h3>
                <p>
                  Получайте кампании, расходы, статусы и сравнения без таблиц и
                  выгрузок.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="capabilities" aria-labelledby="capabilities-title">
          <div className="capabilities__copy">
            <h2 id="capabilities-title">Что AI видит в кабинетах</h2>
            <p>
              Только ваши подключённые аккаунты и только в рамках заданных
              разрешений.
            </p>
            <ul className="capabilities__list">
              <li>Кампании и их статусы на всех платформах</li>
              <li>Расходы и базовые метрики за любой период</li>
              <li>Проблемы с подключениями и доставкой рекламы</li>
              <li>SEO-отчёты и аудит сайта в том же кабинете</li>
            </ul>
          </div>
          <div className="question-list" aria-label="Примеры вопросов">
            <span>Какие рекламные аккаунты подключены?</span>
            <span>Какие кампании сейчас активны?</span>
            <span>Покажи расходы за последние 7 дней</span>
            <span>Где есть проблемы со статусами?</span>
          </div>
        </section>
        <section className="growth" aria-labelledby="growth-title">
          <div>
            <h2 id="growth-title">Больше, чем реклама</h2>
            <p className="growth__lead">
              SEO и качество сайта считаются вместе с рекламой — в одном
              кабинете.
            </p>
          </div>
          <div className="growth__rows">
            <div className="growth-row">
              <div className="growth-row__icon">01</div>
              <div className="growth-row__body">
                <h3>SEO-отчёты из Search Console</h3>
                <p>Понятный отчёт по запросам, страницам, CTR и позициям.</p>
              </div>
            </div>
            <div className="growth-row">
              <div className="growth-row__icon">02</div>
              <div className="growth-row__body">
                <h3>AI-аудит сайта</h3>
                <p>
                  Первый экран, тексты, доверие, конверсия и план приоритетных
                  правок.
                </p>
              </div>
            </div>
          </div>
        </section>
        <section className="control" aria-labelledby="control-title">
          <div className="control__panel">
            <div className="control__lead">
              <span className="control__eyebrow">Безопасность и контроль</span>
              <h2 id="control-title">
                Ни одно изменение не уходит без вашего «да»
              </h2>
              <p>
                AI читает кабинеты, готовит рекомендации и показывает их вам.
                Изменения проходят через preview и подтверждение.
              </p>
            </div>
            <div className="control__demo">
              <span className="control__demo-eyebrow">Пример ответа AI</span>
              <p className="control__demo-text">
                За последние 7 дней стоимость обращения выросла на 18%. Основной
                рост — в кампании «Поиск · Google Ads».
              </p>
              <p className="control__demo-caption">
                Это разбор фактических данных. Кампании и настройки не меняются
                без подтверждения.
              </p>
            </div>
            <ul className="control__points">
              <li>
                <span>✓</span>
                <div>
                  <strong>Только просмотр</strong>
                  <span>AI видит данные, но не тратит бюджет сам.</span>
                </div>
              </li>
              <li>
                <span>✓</span>
                <div>
                  <strong>Личный ключ доступа</strong>
                  <span>Свои аккаунты и ограниченные разрешения.</span>
                </div>
              </li>
              <li>
                <span>✓</span>
                <div>
                  <strong>Без паролей</strong>
                  <span>Официальный вход рекламных платформ.</span>
                </div>
              </li>
            </ul>
          </div>
        </section>
        <section className="cta-band">
          <h2>Подключите первый кабинет сегодня</h2>
          <p>Регистрация и настройка занимают один вечер.</p>
          <Link className="btn btn--primary" href="/auth?mode=signup">
            Создать аккаунт
          </Link>
        </section>
      </div>
      <footer className="footer footer--landing">
        <span>HolyMedia MCP — продукт агентства HolyMedia.</span>
        <span className="footer__links">
          <Link href="/privacy">Политика конфиденциальности</Link>
          <Link href="/terms">Условия использования</Link>
        </span>
      </footer>
    </main>
  );
}
