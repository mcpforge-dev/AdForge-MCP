import Link from "next/link";
import { LanguageSwitcher } from "./language-switcher";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={compact ? "footer footer--app" : "footer footer--landing"}
    >
      <span>HolyMedia MCP — продукт агентства HolyMedia.</span>
      <div className="footer__right">
        <LanguageSwitcher compact />
        <nav className="footer__links" aria-label="Юридическая информация">
          <Link href="/privacy">Политика конфиденциальности</Link>
          <Link href="/terms">Условия использования</Link>
        </nav>
      </div>
    </footer>
  );
}
