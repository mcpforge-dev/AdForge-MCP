import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Политика конфиденциальности | HolyMedia MCP",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <h1>Политика конфиденциальности</h1>
      <p>
        HolyMedia MCP использует данные только для работы подключённых рекламных
        и аналитических функций.
      </p>
      <p>
        Данные OAuth и рекламных кабинетов не публикуются и не передаются
        третьим лицам без основания.
      </p>
    </main>
  );
}
