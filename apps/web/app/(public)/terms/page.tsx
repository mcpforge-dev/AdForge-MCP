import type { Metadata } from "next";
import Link from "next/link";
import { LegalContent } from "../../components/legal-content";
import { LanguageSwitcher } from "../../components/language-switcher";
import { SiteFooter } from "../../components/site-footer";

export const metadata: Metadata = {
  title: "Условия использования | HolyMedia MCP",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <Link className="legal-brand" href="/" aria-label="HolyMedia MCP">
          <span className="logo-dot" aria-hidden="true" />
          HolyMedia MCP
        </Link>
        <div className="legal-language">
          <LanguageSwitcher compact />
        </div>
      </header>
      <LegalContent kind="terms" />
      <SiteFooter />
    </main>
  );
}
