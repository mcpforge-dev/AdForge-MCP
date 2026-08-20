import Link from "next/link";

export default function PublicHomePage() {
  return (
    <main className="home-shell">
      <p className="eyebrow">HolyMedia MCP v2</p>
      <h1>Управляйте рабочими пространствами безопасно.</h1>
      <p className="muted">
        Identity foundation: sessions, workspace membership, roles and audit.
      </p>
      <Link className="primary-button link-button" href="/auth">
        Войти или создать аккаунт
      </Link>
    </main>
  );
}
