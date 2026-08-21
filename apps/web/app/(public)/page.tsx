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
    description:
      "Безопасная аналитика рекламных кабинетов, отчёты и подключение AI-клиентов.",
    publisher: {
      "@type": "Organization",
      name: "HolyMedia",
      url: "https://holymedia.kz",
    },
  };
  return (
    <main className="home-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <header className="public-header">
        <Link className="brand-link" href="/" aria-label="HolyMedia MCP">
          <span className="brand-mark">HM</span>
          HolyMedia MCP
        </Link>
        <Link className="secondary-button compact-button" href="/auth">
          Войти
        </Link>
      </header>
      <section className="hero-band">
        <div>
          <p className="eyebrow">Рекламная аналитика и MCP</p>
          <h1>HolyMedia MCP</h1>
          <p className="hero-copy">
            Подключайте рекламные кабинеты, сравнивайте показатели, собирайте
            клиентские отчёты и безопасно работайте с данными через AI-клиенты.
          </p>
          <Link className="primary-button link-button" href="/auth">
            Начать работу
          </Link>
        </div>
        <div className="product-preview" aria-label="Возможности HolyMedia MCP">
          <div className="preview-toolbar">
            <span>Обзор рекламы</span>
            <span className="status-dot">Данные получены</span>
          </div>
          <div className="preview-metrics">
            <article>
              <small>Расход</small>
              <strong>1 284 500 ₸</strong>
            </article>
            <article>
              <small>Конверсии</small>
              <strong>418</strong>
            </article>
            <article>
              <small>CTR</small>
              <strong>4,82%</strong>
            </article>
          </div>
          <div className="preview-chart" aria-hidden="true">
            {[34, 47, 39, 62, 58, 76, 83, 74, 91, 88, 96, 100].map(
              (height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ),
            )}
          </div>
        </div>
      </section>
      <section className="capability-band" aria-labelledby="capabilities">
        <h2 id="capabilities">Рабочий контур для рекламы</h2>
        <div className="capability-grid">
          <article>
            <strong>Подключения</strong>
            <p>Google Ads, Meta Ads и расширяемая provider-архитектура.</p>
          </article>
          <article>
            <strong>Отчёты</strong>
            <p>Метрики, сравнение периодов и документы для клиента.</p>
          </article>
          <article>
            <strong>MCP</strong>
            <p>Scoped service tokens и серверная проверка каждого аккаунта.</p>
          </article>
          <article>
            <strong>Контроль изменений</strong>
            <p>Preview, подтверждение, commit, повторное чтение и audit.</p>
          </article>
        </div>
      </section>
      <footer className="public-footer">
        <span>© HolyMedia</span>
        <nav aria-label="Правовые документы">
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/terms">Условия</Link>
        </nav>
      </footer>
    </main>
  );
}
