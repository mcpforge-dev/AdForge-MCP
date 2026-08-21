import Link from "next/link";

export default function PublicHomePage() {
  return (
    <main className="home-shell">
      <p className="eyebrow">HolyMedia MCP v2</p>
      <h1>Управляйте рекламными данными из одного рабочего пространства.</h1>
      <p className="muted">
        Безопасное подключение рекламных платформ, отчёты и read-only аналитика
        на реальных данных.
      </p>
      <Link className="primary-button link-button" href="/auth">
        Войти или создать аккаунт
      </Link>
    </main>
  );
}
