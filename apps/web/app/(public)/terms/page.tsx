import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../../components/site-footer";
import { LanguageSwitcher } from "../../components/language-switcher";

export const metadata: Metadata = {
  title: "Terms of use | HolyMedia MCP",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <Link className="legal-brand" href="/" aria-label="HolyMedia MCP">
        <span className="logo-dot" aria-hidden="true" />
        HolyMedia MCP
      </Link>
      <div className="legal-language">
        <LanguageSwitcher compact />
      </div>
      <article className="legal-card">
        <p className="eyebrow">Legal information</p>
        <h1>HolyMedia MCP Terms of Use</h1>
        <p className="legal-updated">Last updated: June 22, 2026</p>
        <p>
          These terms govern access to HolyMedia MCP: the website, workspace,
          advertising platform connections, analytics, and related AI features.
        </p>
        <p>By using HolyMedia MCP, you agree to these terms.</p>
        <h2>1. Service description</h2>
        <p>
          HolyMedia MCP lets you connect advertising accounts, view campaigns,
          statuses, and core metrics, prepare reports, and ask questions through
          compatible AI clients.
        </p>
        <p>
          Real changes in advertising accounts are not performed without
          separate confirmation.
        </p>
        <h2>2. Right to use</h2>
        <p>
          You must have legal authority to connect and view the advertising
          accounts you authorize in HolyMedia MCP.
        </p>
        <h2>3. User account</h2>
        <p>
          You are responsible for the security of your email, password, access
          keys, and connections. If you suspect exposure, change your password,
          revoke the key, or contact support.
        </p>
        <h2>4. Advertising platform connections</h2>
        <p>
          By connecting a platform, you allow HolyMedia MCP to receive data
          within the permissions shown on the OAuth consent screen. You can
          revoke access in HolyMedia MCP or the platform settings.
        </p>
        <h2>5. AI clients</h2>
        <p>
          You choose the AI client and the access you provide to it. Your use of
          Claude, ChatGPT, Codex, and other third-party clients is also governed
          by their own terms.
        </p>
        <h2>6. Acceptable use</h2>
        <p>
          You may not use the service for illegal activity, access to accounts
          belonging to others, bypassing authorization or limits, overloading
          the service, uploading malicious code, or violating advertising
          platform rules.
        </p>
        <h2>7. Advertising action safety</h2>
        <p>
          Recommendations and reports do not guarantee advertising results and
          must be reviewed by you. Any available advertising object change
          requires a preview and explicit confirmation.
        </p>
        <h2>8. Third-party platforms</h2>
        <p>
          We are not responsible for outages, API limits, rule changes,
          suspensions, or reviews by Google, Meta, TikTok, Yandex, or other
          platforms.
        </p>
        <h2>9. Availability and changes</h2>
        <p>
          Features may be updated or temporarily limited to improve security and
          service quality.
        </p>
        <h2>10. Intellectual property</h2>
        <p>
          The HolyMedia MCP interface, code, documentation, brand, and materials
          belong to their rights holders and may not be distributed without
          written permission.
        </p>
        <h2>11. Disclaimer of warranties</h2>
        <p>
          The service is provided “as is” and “as available.” We do not
          guarantee uninterrupted operation or specific advertising results.
        </p>
        <h2>12. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, HolyMedia MCP is not liable
          for indirect losses, lost profits, advertising expenses, or actions of
          third-party platforms.
        </p>
        <h2>13. Suspension</h2>
        <p>
          We may restrict access for a breach of these terms, a security threat,
          abuse of the service, or legal requirements.
        </p>
        <h2>14. Changes to these terms</h2>
        <p>
          We may update these terms. Continued use after an update means you
          accept the new version.
        </p>
        <h2>15. Contact</h2>
        <p>
          <strong>HolyMedia MCP</strong>
          <br />
          Email: <a href="mailto:mcp@holymedia.kz">mcp@holymedia.kz</a>
          <br />
          Сайт: <a href="https://mcp.holymedia.kz">mcp.holymedia.kz</a>
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
