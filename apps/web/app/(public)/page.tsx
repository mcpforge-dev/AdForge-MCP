import Link from "next/link";
import { SiteFooter } from "../components/site-footer";
import { LanguageSwitcher } from "../components/language-switcher";

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
    description: "Connect advertising accounts to Claude, ChatGPT, or Codex.",
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
        <nav className="site-nav" aria-label="Navigation">
          <a href="#steps">How it works</a>
          <LanguageSwitcher compact />
          <Link className="btn btn--secondary btn--small" href="/auth">
            Sign in
          </Link>
          <Link
            className="btn btn--primary btn--small"
            href="/auth?mode=signup"
          >
            Create account
          </Link>
        </nav>
      </header>

      <div className="landing-main">
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">Advertising analytics and MCP</p>
            <h1>All your advertising in one AI chat</h1>
            <p>
              Connect Meta, Google Ads, TikTok, and Yandex Direct. Ask about
              campaigns, spend, and results in Claude, ChatGPT, or Codex.
            </p>
            <div className="hero__actions">
              <Link className="btn btn--primary" href="/auth?mode=signup">
                Create account
              </Link>
              <Link className="btn btn--secondary" href="/auth">
                Sign in
              </Link>
            </div>
          </div>
          <div className="hero-chat" aria-label="Example AI answer">
            <div className="hero-chat__title">
              <span>Example answer</span>
              <span>Claude · ChatGPT · Codex</span>
            </div>
            <div className="hero-chat__q">
              Which campaigns are active and how much did we spend this week?
            </div>
            <div className="hero-chat__a">
              <strong>
                3 campaigns are active; spend over 7 days is 412,500 KZT.
              </strong>
              <span className="hero-chat__row">
                <span>Lead generation · Meta Ads</span>
                <b>184 300 ₸</b>
              </span>
              <span className="hero-chat__row">
                <span>Search · Google Ads</span>
                <b>141 900 ₸</b>
              </span>
              <span className="hero-chat__row">
                <span>Retargeting · Yandex Direct</span>
                <b>86 300 ₸</b>
              </span>
              <span className="hero-chat__src">Demo data · read-only</span>
            </div>
          </div>
        </section>

        <section id="steps" className="how" aria-labelledby="steps-title">
          <h2 id="steps-title">Three steps to your first answer</h2>
          <p className="how__intro">
            Connect through the advertising platform's official authorization
            flow.
          </p>
          <ol className="how-steps">
            <li className="how-step">
              <div className="how-step__num">1</div>
              <div className="how-step__body">
                <h3>Connect a platform</h3>
                <p>Sign in with Google, Meta, TikTok, or Yandex.</p>
              </div>
            </li>
            <li className="how-arrow" aria-hidden="true">
              →
            </li>
            <li className="how-step">
              <div className="how-step__num">2</div>
              <div className="how-step__body">
                <h3>Choose accounts</h3>
                <p>Select the accounts your AI client can access.</p>
              </div>
            </li>
            <li className="how-arrow" aria-hidden="true">
              →
            </li>
            <li className="how-step">
              <div className="how-step__num">3</div>
              <div className="how-step__body">
                <h3>Connect MCP</h3>
                <p>Copy the URL and follow the instructions for your client.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="capabilities" aria-labelledby="capabilities-title">
          <div className="capabilities__copy">
            <h2 id="capabilities-title">What you can learn</h2>
            <p>AI can see only the advertising accounts you select.</p>
            <ul className="capabilities__list">
              <li>which campaigns are active and where problems exist;</li>
              <li>how much was spent during the selected period;</li>
              <li>how impressions, clicks, and conversions changed;</li>
              <li>which campaign spent the most.</li>
            </ul>
          </div>
          <div className="question-list" aria-label="Example questions">
            <span>Which advertising accounts are connected?</span>
            <span>Which campaigns are active right now?</span>
            <span>Show spend for the last 7 days</span>
            <span>Compare the current period with the previous one</span>
          </div>
        </section>

        <section className="control" aria-labelledby="control-title">
          <div className="control__panel">
            <div className="control__lead">
              <span className="control__eyebrow">Security</span>
              <h2 id="control-title">Changes require your approval</h2>
              <p>
                HolyMedia MCP is read-only by default. Any available change is
                previewed first and waits for your approval.
              </p>
            </div>
            <ul className="control__points">
              <li>
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Only selected accounts</strong>
                  <span>Access is limited to your account.</span>
                </div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>No password sharing</strong>
                  <span>Connection uses official OAuth.</span>
                </div>
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Action control</strong>
                  <span>Nothing changes without approval.</span>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className="cta-band">
          <h2>Connect your first account</h2>
          <p>Create an account and choose an advertising platform.</p>
          <Link className="btn btn--primary" href="/auth?mode=signup">
            Create account
          </Link>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
