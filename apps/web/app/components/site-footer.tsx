"use client";

import Link from "next/link";
import { useLanguage } from "./language-switcher";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const language = useLanguage();
  const copy =
    language === "ru"
      ? {
          contact: "Напишите нам:",
          legal: "Юридическая информация",
          privacy: "Политика конфиденциальности",
          terms: "Условия использования",
          astanaHub: "Astana Hub",
        }
      : {
          contact: "Email us:",
          legal: "Legal information",
          privacy: "Privacy policy",
          terms: "Terms of use",
          astanaHub: "Astana Hub",
        };

  return (
    <footer
      className={compact ? "footer footer--app" : "footer footer--landing"}
      data-language-static
    >
      <div className="footer__left">
        <div className="footer__identity">
          <img
            className="footer__brand-logo"
            src="/assets/brand/holymedia-mcp-horizontal.svg"
            alt="HolyMedia MCP"
          />
          <span className="footer__contact">
            {copy.contact}{" "}
            <a href="mailto:mcp@holymedia.kz">mcp@holymedia.kz</a>
          </span>
        </div>
        <a
          className="footer__partner"
          href="https://astanahub.com/"
          target="_blank"
          rel="noreferrer"
          aria-label={copy.astanaHub}
        >
          <img src="/assets/astana-hub-logo.svg" alt="Astana Hub" />
        </a>
      </div>
      <nav className="footer__links" aria-label={copy.legal}>
        <Link href="/privacy">{copy.privacy}</Link>
        <Link href="/terms">{copy.terms}</Link>
      </nav>
    </footer>
  );
}
