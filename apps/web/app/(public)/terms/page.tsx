import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Условия использования | HolyMedia MCP",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <h1>Условия использования</h1>
      <p>
        HolyMedia MCP предоставляет инструменты аналитики и управления
        рекламными данными в пределах выданных разрешений.
      </p>
      <p>
        Изменения рекламных объектов выполняются только при наличии
        соответствующих прав и явного подтверждения.
      </p>
    </main>
  );
}
