from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
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


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


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
        self._schema_ready = False
        self._schema_lock = threading.Lock()

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
        if self._schema_ready:
            return
        with self._schema_lock:
            if self._schema_ready:
                return
            with self._connect() as connection:
                for statement in _SCHEMA:
                    self._execute(connection, statement)
            self._schema_ready = True

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

    def create_password_reset_token(self, email: str) -> tuple[AuthUser, str] | None:
        email = _normalize_email(email)
        if "@" not in email:
            return None
        raw_token = f"reset_{secrets.token_urlsafe(32)}"
        token_hash = _hash_value(raw_token)
        token_id = uuid.uuid4().hex
        created_at = _now()
        expires_at = (datetime.now(UTC) + timedelta(minutes=max(1, self.settings.password_reset_ttl_minutes))).replace(microsecond=0)
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
            if not row:
                return None
            user = self._row_to_user(row)
            if not user.is_active:
                return None
            self._execute(
                connection,
                "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
                (created_at, user.id),
            )
            self._execute(
                connection,
                """
                INSERT INTO password_reset_tokens
                  (id, user_id, token_hash, created_at, expires_at, used_at)
                VALUES (?, ?, ?, ?, ?, NULL)
                """,
                (token_id, user.id, token_hash, created_at, expires_at.isoformat().replace("+00:00", "Z")),
            )
        return user, raw_token

    def reset_password(self, token: str, new_password: str, confirm_password: str) -> AuthUser:
        token = token.strip()
        if not token:
            raise AuthValidationError("Ссылка восстановления недействительна.")
        if new_password != confirm_password:
            raise AuthValidationError("Пароли не совпадают.")
        password_digest = _password_hash(new_password)
        token_hash = _hash_value(token)
        now_text = _now()
        now_dt = datetime.now(UTC).replace(microsecond=0)
        with self._connect() as connection:
            row = self._query_one(
                connection,
                """
                SELECT rt.id AS reset_id, rt.expires_at, rt.used_at, u.*, wm.workspace_id
                FROM password_reset_tokens rt
                JOIN users u ON u.id = rt.user_id
                LEFT JOIN workspace_members wm ON wm.user_id = u.id
                WHERE rt.token_hash = ?
                ORDER BY wm.created_at ASC
                LIMIT 1
                """,
                (token_hash,),
            )
            if not row or row.get("used_at"):
                raise AuthValidationError("Ссылка восстановления недействительна или уже использована.")
            expires_at = _parse_time(str(row.get("expires_at") or ""))
            if not expires_at or expires_at <= now_dt:
                raise AuthValidationError("Срок действия ссылки восстановления истёк.")
            user = self._row_to_user(row)
            if not user.is_active:
                raise AuthValidationError("Аккаунт отключён. Обратитесь к администратору.")
            self._execute(
                connection,
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (password_digest, now_text, user.id),
            )
            self._execute(
                connection,
                "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
                (now_text, user.id),
            )
            self._execute(
                connection,
                "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                (now_text, user.id),
            )
            return user

    def change_password(self, user_id: str, current_password: str, new_password: str, confirm_password: str) -> None:
        if new_password != confirm_password:
            raise AuthValidationError("Пароли не совпадают.")
        password_digest = _password_hash(new_password)
        with self._connect() as connection:
            row = self._query_one(connection, "SELECT password_hash FROM users WHERE id = ?", (user_id,))
            if not row:
                raise AuthValidationError("Пользователь не найден.")
            if not _verify_password(current_password, str(row["password_hash"])):
                raise AuthValidationError("Текущий пароль указан неверно.")
            self._execute(
                connection,
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (password_digest, _now(), user_id),
            )

    def profile_summary(self, user_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = self._query_one(
                connection,
                """
                SELECT u.id, u.email, u.name, u.status, u.created_at, p.avatar_url
                FROM users u
                LEFT JOIN user_profiles p ON p.user_id = u.id
                WHERE u.id = ?
                """,
                (user_id,),
            )
            if not row:
                raise AuthValidationError("Пользователь не найден.")
            platforms = self._query_all(
                connection,
                """
                SELECT pc.platform, COUNT(sa.id) AS account_count
                FROM platform_connections pc
                LEFT JOIN selected_ad_accounts sa ON sa.connection_id = pc.id AND sa.status = 'active'
                WHERE pc.user_id = ? AND pc.status = 'connected'
                GROUP BY pc.platform
                ORDER BY pc.platform
                """,
                (user_id,),
            )
        connected_platforms = [str(item["platform"]) for item in platforms if int(item.get("account_count") or 0) > 0]
        return {
            "email": str(row["email"]),
            "nickname": str(row.get("name") or row["email"]),
            "avatar_url": str(row.get("avatar_url") or ""),
            "account_status": str(row.get("status") or "disabled"),
            "created_at": row.get("created_at"),
            "connected_platforms_count": len(connected_platforms),
            "connected_ad_accounts_count": sum(int(item.get("account_count") or 0) for item in platforms),
            "connected_platforms": connected_platforms,
        }

    def update_profile(self, user_id: str, *, nickname: str) -> dict[str, Any]:
        nickname = " ".join(nickname.strip().split())
        if not nickname:
            raise AuthValidationError("Никнейм не может быть пустым.")
        if len(nickname) > 80:
            raise AuthValidationError("Никнейм должен быть не длиннее 80 символов.")
        with self._connect() as connection:
            self._execute(connection, "UPDATE users SET name = ?, updated_at = ? WHERE id = ?", (nickname, _now(), user_id))
        return self.profile_summary(user_id)

    def set_avatar(self, user_id: str, *, avatar_url: str, avatar_path: str) -> dict[str, Any]:
        timestamp = _now()
        with self._connect() as connection:
            self._execute(
                connection,
                """
                INSERT INTO user_profiles (user_id, avatar_url, avatar_path, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET avatar_url = excluded.avatar_url, avatar_path = excluded.avatar_path, updated_at = excluded.updated_at
                """,
                (user_id, avatar_url, avatar_path, timestamp),
            )
        return self.profile_summary(user_id)

    def avatar_path(self, user_id: str) -> str:
        with self._connect() as connection:
            row = self._query_one(connection, "SELECT avatar_path FROM user_profiles WHERE user_id = ?", (user_id,))
        return str(row.get("avatar_path") or "") if row else ""

    def mcp_token_summary(self, user_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = self._query_one(
                connection,
                """
                SELECT id, token_prefix, name, status, created_at, last_used_at, revoked_at
                FROM mcp_access_tokens
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (user_id,),
            )
        return self._safe_mcp_token_summary(row)

    def create_mcp_token(self, user: AuthUser, *, name: str = "Personal MCP token") -> dict[str, Any]:
        active = self.mcp_token_summary(user.id)
        if active.get("exists") and active.get("status") == "active":
            raise AuthValidationError("У пользователя уже есть активный MCP token. Сгенерируйте новый token или отзовите текущий.")
        with self._connect() as connection:
            return self._insert_mcp_token(connection, user, name=name)

    def rotate_mcp_token(self, user: AuthUser, *, name: str = "Personal MCP token") -> dict[str, Any]:
        with self._connect() as connection:
            now = _now()
            self._execute(
                connection,
                """
                UPDATE mcp_access_tokens
                SET status = 'revoked', revoked_at = ?
                WHERE user_id = ? AND status = 'active' AND revoked_at IS NULL
                """,
                (now, user.id),
            )
            return self._insert_mcp_token(connection, user, name=name)

    def revoke_mcp_token(self, user_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            now = _now()
            self._execute(
                connection,
                """
                UPDATE mcp_access_tokens
                SET status = 'revoked', revoked_at = ?
                WHERE user_id = ? AND status = 'active' AND revoked_at IS NULL
                """,
                (now, user_id),
            )
        return self.mcp_token_summary(user_id)

    def verify_mcp_token(self, token: str) -> AuthUser | None:
        if not token:
            return None
        token_hash = _hash_value(token)
        with self._connect() as connection:
            row = self._query_one(
                connection,
                """
                SELECT u.*, COALESCE(t.workspace_id, wm.workspace_id) AS workspace_id
                FROM mcp_access_tokens t
                JOIN users u ON u.id = t.user_id
                LEFT JOIN workspace_members wm ON wm.user_id = u.id
                WHERE t.token_hash = ?
                  AND t.status = 'active'
                  AND t.revoked_at IS NULL
                ORDER BY wm.created_at ASC
                LIMIT 1
                """,
                (token_hash,),
            )
            if not row:
                return None
            user = self._row_to_user(row)
            if not user.is_active:
                return None
            self._execute(connection, "UPDATE mcp_access_tokens SET last_used_at = ? WHERE token_hash = ?", (_now(), token_hash))
            return user

    def list_users(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = self._query_all(
                connection,
                """
                SELECT
                  u.id, u.email, u.name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
                  COUNT(DISTINCT pc.id) AS platform_connections,
                  (
                    SELECT COUNT(*)
                    FROM mcp_access_tokens mt
                    WHERE mt.user_id = u.id AND mt.status = 'active' AND mt.revoked_at IS NULL
                  ) AS active_mcp_tokens,
                  (
                    SELECT mt.token_prefix
                    FROM mcp_access_tokens mt
                    WHERE mt.user_id = u.id
                    ORDER BY mt.created_at DESC
                    LIMIT 1
                  ) AS mcp_token_prefix,
                  (
                    SELECT mt.status
                    FROM mcp_access_tokens mt
                    WHERE mt.user_id = u.id
                    ORDER BY mt.created_at DESC
                    LIMIT 1
                  ) AS mcp_token_status,
                  (
                    SELECT mt.last_used_at
                    FROM mcp_access_tokens mt
                    WHERE mt.user_id = u.id
                    ORDER BY mt.created_at DESC
                    LIMIT 1
                  ) AS mcp_token_last_used_at
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
                active_mcp_tokens = self._query_one(
                    connection,
                    "SELECT COUNT(*) AS count FROM mcp_access_tokens WHERE status = 'active' AND revoked_at IS NULL",
                ) or {"count": 0}
            return {
                "status": "ok",
                "driver": self.driver,
                "configured": bool(self.settings.database_url.strip()),
                "users": int(users["count"]),
                "active_sessions": int(sessions["count"]),
                "active_mcp_tokens": int(active_mcp_tokens["count"]),
            }
        except AuthStoreError as exc:
            return {"status": "error", "driver": self.driver, "error": str(exc)}

    def _insert_mcp_token(self, connection, user: AuthUser, *, name: str) -> dict[str, Any]:
        raw_token = f"mcp_live_{secrets.token_urlsafe(32)}"
        token_id = uuid.uuid4().hex
        timestamp = _now()
        token_prefix = raw_token[:18]
        self._execute(
            connection,
            """
            INSERT INTO mcp_access_tokens
              (id, user_id, workspace_id, token_hash, token_prefix, name, status, created_at, last_used_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL)
            """,
            (token_id, user.id, user.workspace_id, _hash_value(raw_token), token_prefix, name.strip() or "Personal MCP token", timestamp),
        )
        summary = self._safe_mcp_token_summary(
            {
                "id": token_id,
                "token_prefix": token_prefix,
                "name": name,
                "status": "active",
                "created_at": timestamp,
                "last_used_at": None,
                "revoked_at": None,
            }
        )
        return summary | {"raw_token": raw_token}

    def _safe_mcp_token_summary(self, row: dict[str, Any] | None) -> dict[str, Any]:
        if not row:
            return {
                "exists": False,
                "token_prefix": "",
                "name": "",
                "status": "missing",
                "created_at": None,
                "last_used_at": None,
                "revoked_at": None,
            }
        return {
            "exists": True,
            "token_prefix": str(row.get("token_prefix") or ""),
            "name": str(row.get("name") or "Personal MCP token"),
            "status": str(row.get("status") or "missing"),
            "created_at": row.get("created_at"),
            "last_used_at": row.get("last_used_at"),
            "revoked_at": row.get("revoked_at"),
        }

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
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      avatar_url TEXT,
      avatar_path TEXT,
      updated_at TEXT NOT NULL
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
