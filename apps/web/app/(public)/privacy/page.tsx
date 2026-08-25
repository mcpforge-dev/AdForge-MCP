import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../../components/site-footer";
import { LanguageSwitcher } from "../../components/language-switcher";

export const metadata: Metadata = {
  title: "Privacy policy | HolyMedia MCP",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
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
        <h1>HolyMedia MCP Privacy Policy</h1>
        <p className="legal-updated">Last updated: June 22, 2026</p>
        <p>
          HolyMedia MCP is a B2B service for connecting advertising accounts,
          viewing advertising data, analyzing campaigns, and working with AI
          clients.
        </p>
        <p>
          This policy explains what data we collect, how we use it, and how we
          protect it when you use the website, workspace, and OAuth connections
          to advertising platforms.
        </p>
        <h2>1. Data we collect</h2>
        <p>We may process the following categories of data:</p>
        <ul>
          <li>
            account data: name, email, profile settings, account status, and
            session data;
          </li>
          <li>
            advertising connection data: platform, IDs and names of available
            advertising accounts, and accounts selected by the user;
          </li>
          <li>
            advertising data: campaigns, statuses, budgets, spend, impressions,
            clicks, conversions, and core performance metrics;
          </li>
          <li>authorization data needed to maintain connections;</li>
          <li>
            technical data: IP address, browser type, diagnostic events, errors,
            and security logs.
          </li>
        </ul>
        <h2>2. How we use data</h2>
        <p>We use data only to provide HolyMedia MCP features:</p>
        <ul>
          <li>creating and maintaining your workspace;</li>
          <li>connecting advertising platforms through OAuth;</li>
          <li>
            displaying advertising accounts, campaigns, statuses, and metrics;
          </li>
          <li>preparing reports, recommendations, and action previews;</li>
          <li>serving AI clients connected by the user;</li>
          <li>providing security, abuse prevention, and service support.</li>
        </ul>
        <h2>3. Google and Meta data</h2>
        <p>
          HolyMedia MCP receives Google Ads and Meta Ads data only after the
          user's explicit OAuth permission and uses it only for advertising
          analytics and work with connected accounts.
        </p>
        <p>
          We do not sell advertising platform data or use it for lending,
          unrelated profiling, or third-party advertising. Google API data is
          handled in accordance with the Google API Services User Data Policy,
          including Limited Use requirements.
        </p>
        <h2>4. Sharing with third parties</h2>
        <p>
          We do not sell personal or advertising data. Limited sharing may occur
          only with infrastructure providers, authorized advertising platforms,
          AI clients connected by the user, or where legally required.
        </p>
        <h2>5. Storage and security</h2>
        <p>
          We use HTTPS, encrypted OAuth connections, hashed access keys, tenant
          isolation, restricted production access, and secure diagnostic logs.
        </p>
        <p>
          Platform secrets, keys, and service data are never published or shown
          again after they are saved.
        </p>
        <h2>6. Retention</h2>
        <p>
          Data is retained only as long as necessary to provide the service,
          maintain security, meet legal requirements, and support users.
        </p>
        <h2>7. Your rights and deletion</h2>
        <p>
          You may request account deletion, disconnection of advertising
          platforms, export, or clarification of your data by contacting
          support. You can also revoke application access in the settings of the
          relevant platform.
        </p>
        <h2>8. International processing</h2>
        <p>
          Data may be processed on infrastructure outside the user's country of
          residence. We apply reasonable safeguards consistent with this policy.
        </p>
        <h2>9. Policy changes</h2>
        <p>
          We may update this policy. Material changes to data processing will be
          reflected on this page and, where required, will require renewed
          consent.
        </p>
        <h2>10. Contact</h2>
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
