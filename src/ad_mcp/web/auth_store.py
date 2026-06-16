from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from ad_mcp.settings import Settings


class AuthStoreError(RuntimeError):
    pass


class AuthDatabaseUnavailable(AuthStoreError):
    pass


class AuthValidationError(AuthStoreError):
    pass


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str
    name: str
    role: str
    status: str
    workspace_id: str | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_active(self) -> bool:
        return self.status == "active"

    def public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "status": self.status,
            "workspace_id": self.workspace_id,
        }


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _hash_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _password_hash(password: str) -> str:
    if len(password) < 8:
        raise AuthValidationError("Пароль должен быть не короче 8 символов.")
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240_000)
    return "pbkdf2_sha256$240000$%s$%s" % (
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iterations, salt_b64, digest_b64 = encoded.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected = base64.b64decode(digest_b64.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


class AuthStore:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()
        self.database_url = self.settings.effective_database_url
        self.driver = self._driver_name(self.database_url)

    @staticmethod
    def _driver_name(database_url: str) -> str:
        parsed = urlparse(database_url)
        if parsed.scheme in {"", "sqlite"}:
            return "sqlite"
        if parsed.scheme in {"postgres", "postgresql"}:
            return "postgres"
        raise AuthDatabaseUnavailable(f"Unsupported AD_MCP_DATABASE_URL scheme: {parsed.scheme}")

    def _sqlite_path(self) -> Path:
        parsed = urlparse(self.database_url)
        if parsed.scheme == "sqlite":
            raw_path = unquote(parsed.path or "")
            if raw_path.startswith("/") and len(raw_path) > 3 and raw_path[2] == ":":
                raw_path = raw_path[1:]
            path = Path(raw_path or "tokens/adforge_auth.db")
        else:
            path = Path(self.database_url)
        if not path.is_absolute():
            path = self.settings.project_root / path
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    @contextmanager
    def _connect(self):
        if self.driver == "sqlite":
            connection = sqlite3.connect(self._sqlite_path())
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            try:
                yield connection
                connection.commit()
            finally:
                connection.close()
            return

        try:
            import psycopg  # type: ignore[import-not-found]
            from psycopg.rows import dict_row  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AuthDatabaseUnavailable(
                "PostgreSQL auth storage requires optional dependency psycopg. "
                "Install with: pip install 'psycopg[binary]>=3.2'."
            ) from exc

        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection
            connection.commit()

    def _placeholder(self) -> str:
        return "?" if self.driver == "sqlite" else "%s"

    def _execute(self, connection, sql: str, values: tuple[Any, ...] = ()) -> None:
        connection.execute(sql.replace("?", self._placeholder()), values)

    def _query_one(self, connection, sql: str, values: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        cursor = connection.execute(sql.replace("?", self._placeholder()), values)
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    def _query_all(self, connection, sql: str, values: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        cursor = connection.execute(sql.replace("?", self._placeholder()), values)
        return [dict(row) for row in cursor.fetchall()]

    def ensure_schema(self) -> None:
        with self._connect() as connection:
            for statement in _SCHEMA:
                self._execute(connection, statement)

    def create_user(
        self,
        *,
        email: str,
        name: str,
        password: str,
        role: str = "user",
        status: str = "active",
    ) -> AuthUser:
        email = _normalize_email(email)
        name = name.strip() or email
        role = role.strip().lower()
        status = status.strip().lower()
        if role not in {"user", "admin"}:
            raise AuthValidationError("Некорректная роль пользователя.")
        if status not in {"active", "disabled"}:
            raise AuthValidationError("Некорректный статус пользователя.")
        if "@" not in email:
            raise AuthValidationError("Введите корректный email.")

        user_id = uuid.uuid4().hex
        workspace_id = uuid.uuid4().hex
        member_id = uuid.uuid4().hex
        timestamp = _now()
        password_digest = _password_hash(password)
        with self._connect() as connection:
            existing = self._query_one(connection, "SELECT id FROM users WHERE email = ?", (email,))
            if existing:
                raise AuthValidationError("Пользователь с таким email уже существует.")
            self._execute(
                connection,
                """
                INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, email, name, password_digest, role, status, timestamp, timestamp),
            )
            self._execute(
                connection,
                """
                INSERT INTO workspaces (id, name, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (workspace_id, f"{name} workspace", "active", timestamp, timestamp),
            )
            self._execute(
                connection,
                """
                INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (member_id, workspace_id, user_id, "owner", timestamp),
            )
        return AuthUser(user_id, email, name, role, status, workspace_id)

    def authenticate(self, email: str, password: str) -> AuthUser:
        email = _normalize_email(email)
        with self._connect() as connection:
            row = self._query_one(
                connection,
                """
                SELECT u.*, wm.workspace_id
                FROM users u
                LEFT JOIN workspace_members wm ON wm.user_id = u.id
                WHERE u.email = ?
                ORDER BY wm.created_at ASC
                LIMIT 1
                """,
                (email,),
            )
            if not row or not _verify_password(password, str(row["password_hash"])):
                raise AuthValidationError("Неверный email или пароль.")
            user = self._row_to_user(row)
            if not user.is_active:
                raise AuthValidationError("Аккаунт отключён. Обратитесь к администратору.")
            self._execute(connection, "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (_now(), _now(), user.id))
            return user

    def create_session(self, user_id: str, *, user_agent: str = "", ip_address: str = "") -> tuple[str, str]:
        session_id = uuid.uuid4().hex
        token = f"afs_{secrets.token_urlsafe(32)}"
        token_hash = _hash_value(token)
        created_at = _now()
        expires_at = (datetime.now(UTC) + timedelta(hours=self.settings.auth_session_ttl_hours)).replace(microsecond=0)
        ip_hash = _hash_value(ip_address) if ip_address else ""
        with self._connect() as connection:
            self._execute(
                connection,
                """
                INSERT INTO user_sessions
                  (id, user_id, session_token_hash, created_at, expires_at, revoked_at, user_agent, ip_hash)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (session_id, user_id, token_hash, created_at, expires_at.isoformat().replace("+00:00", "Z"), user_agent[:240], ip_hash),
            )
        return token, session_id

    def user_for_session(self, token: str) -> AuthUser | None:
        if not token:
            return None
        token_hash = _hash_value(token)
        now = _now()
        with self._connect() as connection:
            row = self._query_one(
                connection,
                """
                SELECT u.*, wm.workspace_id
                FROM user_sessions s
                JOIN users u ON u.id = s.user_id
                LEFT JOIN workspace_members wm ON wm.user_id = u.id
                WHERE s.session_token_hash = ?
                  AND s.revoked_at IS NULL
                  AND s.expires_at > ?
                ORDER BY wm.created_at ASC
                LIMIT 1
                """,
                (token_hash, now),
            )
            if not row:
                return None
            user = self._row_to_user(row)
            return user if user.is_active else None

    def revoke_session(self, token: str) -> None:
        if not token:
            return
        with self._connect() as connection:
            self._execute(
                connection,
                "UPDATE user_sessions SET revoked_at = ? WHERE session_token_hash = ? AND revoked_at IS NULL",
                (_now(), _hash_value(token)),
            )

    def list_users(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = self._query_all(
                connection,
                """
                SELECT
                  u.id, u.email, u.name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
                  COUNT(DISTINCT pc.id) AS platform_connections
                FROM users u
                LEFT JOIN platform_connections pc ON pc.user_id = u.id
                GROUP BY u.id, u.email, u.name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at
                ORDER BY u.created_at DESC
                """,
            )
        return rows

    def set_user_status(self, user_id: str, status: str) -> dict[str, Any]:
        status = status.strip().lower()
        if status not in {"active", "disabled"}:
            raise AuthValidationError("Некорректный статус пользователя.")
        with self._connect() as connection:
            self._execute(connection, "UPDATE users SET status = ?, updated_at = ? WHERE id = ?", (status, _now(), user_id))
            row = self._query_one(
                connection,
                "SELECT id, email, name, role, status, created_at, updated_at, last_login_at FROM users WHERE id = ?",
                (user_id,),
            )
            if not row:
                raise AuthValidationError("Пользователь не найден.")
            return row

    def set_user_role(self, user_id: str, role: str) -> dict[str, Any]:
        role = role.strip().lower()
        if role not in {"user", "admin"}:
            raise AuthValidationError("Некорректная роль пользователя.")
        with self._connect() as connection:
            self._execute(connection, "UPDATE users SET role = ?, updated_at = ? WHERE id = ?", (role, _now(), user_id))
            row = self._query_one(
                connection,
                "SELECT id, email, name, role, status, created_at, updated_at, last_login_at FROM users WHERE id = ?",
                (user_id,),
            )
            if not row:
                raise AuthValidationError("Пользователь не найден.")
            return row

    def diagnostics(self) -> dict[str, Any]:
        try:
            self.ensure_schema()
            with self._connect() as connection:
                users = self._query_one(connection, "SELECT COUNT(*) AS count FROM users") or {"count": 0}
                sessions = self._query_one(connection, "SELECT COUNT(*) AS count FROM user_sessions WHERE revoked_at IS NULL") or {"count": 0}
            return {
                "status": "ok",
                "driver": self.driver,
                "configured": bool(self.settings.database_url.strip()),
                "users": int(users["count"]),
                "active_sessions": int(sessions["count"]),
            }
        except AuthStoreError as exc:
            return {"status": "error", "driver": self.driver, "error": str(exc)}

    def _row_to_user(self, row: dict[str, Any]) -> AuthUser:
        return AuthUser(
            id=str(row["id"]),
            email=str(row["email"]),
            name=str(row.get("name") or row["email"]),
            role=str(row.get("role") or "user"),
            status=str(row.get("status") or "disabled"),
            workspace_id=str(row["workspace_id"]) if row.get("workspace_id") else None,
        )


_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, user_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT,
      ip_hash TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS mcp_access_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS platform_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      user_id TEXT,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_connected',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_success_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS selected_ad_accounts (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS oauth_states (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      user_id TEXT,
      provider TEXT NOT NULL,
      state_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata_json TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      workspace_id TEXT,
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )
    """,
]
