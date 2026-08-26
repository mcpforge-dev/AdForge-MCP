"use client";

import Link from "next/link";
import { useLanguage } from "./language-switcher";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const language = useLanguage();
  const copy =
    language === "ru"
      ? {
          product: "HolyMedia MCP — продукт агентства HolyMedia.",
          legal: "Юридическая информация",
          privacy: "Политика конфиденциальности",
          terms: "Условия использования",
          astanaHub: "Astana Hub",
        }
      : {
          product: "HolyMedia MCP is a HolyMedia agency product.",
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
        <span className="footer__product">{copy.product}</span>
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
