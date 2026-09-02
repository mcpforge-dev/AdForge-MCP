import type { Metadata } from "next";
import { LegalContent } from "../../components/legal-content";
import { LegalHeader } from "../../components/legal-header";
import { SiteFooter } from "../../components/site-footer";

export const metadata: Metadata = {
  title: "Условия использования",
  description: "Условия использования HolyMedia MCP.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <LegalHeader />
      <LegalContent kind="terms" />
      <SiteFooter />
    </main>
  );
}
