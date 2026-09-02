import type { Metadata } from "next";
import { LegalContent } from "../../components/legal-content";
import { LegalHeader } from "../../components/legal-header";
import { SiteFooter } from "../../components/site-footer";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  description: "Политика конфиденциальности HolyMedia MCP.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <LegalHeader />
      <LegalContent kind="privacy" />
      <SiteFooter />
    </main>
  );
}
