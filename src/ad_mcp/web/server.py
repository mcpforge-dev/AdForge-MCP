from __future__ import annotations

import json
import logging
import mimetypes
import secrets
import threading
import time
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse

from ad_mcp.core.errors import AdMCPError, normalize_error
from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.settings import Settings, is_network_exposed_host, is_strict_auth_env
from ad_mcp.tools.site_analysis import analyze_site_improvements
from ad_mcp.web.auth_store import (
    AuthDatabaseUnavailable,
    AuthInvalidClientError,
    AuthStore,
    AuthUser,
    AuthValidationError,
    EmailAlreadyRegisteredError,
)
from ad_mcp.web.diagnostics import DiagnosticsService
from ad_mcp.web.emailer import EmailDeliveryError, PasswordResetEmailer
from ad_mcp.web.google_login import GoogleLoginError, GoogleLoginService
from ad_mcp.web.hosted import HostedConnectionService
from ad_mcp.web.service import MetaDashboardService


WEB_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = WEB_ROOT / "static"
LOGGER = logging.getLogger(__name__)
AUTH_HEADER = "Authorization"
TOKEN_HEADER = "X-AD-MCP-BETA-TOKEN"


def _api_token_required(settings: Settings) -> bool:
    return bool(settings.web_api_token.strip()) or is_strict_auth_env(settings.env) or is_network_exposed_host(settings.web_host)


def _extract_request_token(headers) -> str:
    header_value = str(headers.get(AUTH_HEADER, "") or "").strip()
    if header_value.lower().startswith("bearer "):
        return header_value[7:].strip()
    return str(headers.get(TOKEN_HEADER, "") or "").strip()


def _request_token_is_valid(headers, settings: Settings) -> bool:
    expected = settings.web_api_token.strip()
    if not _api_token_required(settings):
        return True
    if not expected:
        return False
    candidate = _extract_request_token(headers)
    return bool(candidate) and secrets.compare_digest(candidate, expected)


class AdsWebHandler(BaseHTTPRequestHandler):
    settings = Settings()
    diagnostics = DiagnosticsService()
    hosted = HostedConnectionService()
    service = MetaDashboardService()
    auth = AuthStore()
    emailer = PasswordResetEmailer()
    google_login = GoogleLoginService()
    _omit_response_body = False
    _rate_limit_lock = threading.Lock()
    _rate_limit_hits: dict[str, list[float]] = {}

    def _set_default_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("Vary", "Authorization, Cookie")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._set_default_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not self._omit_response_body:
            self.wfile.write(body)

    def _send_auth_json(
        self,
        payload: dict,
        *,
        session_token: str | None = None,
        clear_session: bool = False,
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._set_default_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if session_token:
            self._send_session_cookie(session_token)
        if clear_session:
            self._clear_session_cookie()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not self._omit_response_body:
            self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self._set_default_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not self._omit_response_body:
            self.wfile.write(body)

    def _send_avatar_file(self, filename: str) -> None:
        clean = Path(filename).name
        if clean != filename or not clean:
            return self._error("Файл не найден.", HTTPStatus.NOT_FOUND, "not_found")
        path = self.settings.profile_upload_path / "avatars" / clean
        if not path.exists() or not path.is_file():
            return self._error("Файл не найден.", HTTPStatus.NOT_FOUND, "not_found")
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            return self._error("Файл не найден.", HTTPStatus.NOT_FOUND, "not_found")
        return self._send_file(path, content_type)

    def _redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self._set_default_headers()
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _redirect_with_session(self, location: str, session_token: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self._set_default_headers()
        self._send_session_cookie(session_token)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_session_cookie(self, token: str) -> None:
        cookie = SimpleCookie()
        cookie[self.settings.auth_session_cookie_name] = token
        cookie[self.settings.auth_session_cookie_name]["path"] = "/"
        cookie[self.settings.auth_session_cookie_name]["httponly"] = True
        cookie[self.settings.auth_session_cookie_name]["samesite"] = "Lax"
        cookie[self.settings.auth_session_cookie_name]["max-age"] = str(self.settings.auth_session_ttl_hours * 3600)
        if self.settings.auth_secure_cookies:
            cookie[self.settings.auth_session_cookie_name]["secure"] = True
        for morsel in cookie.values():
            self.send_header("Set-Cookie", morsel.OutputString())

    def _clear_session_cookie(self) -> None:
        cookie = SimpleCookie()
        cookie[self.settings.auth_session_cookie_name] = ""
        cookie[self.settings.auth_session_cookie_name]["path"] = "/"
        cookie[self.settings.auth_session_cookie_name]["httponly"] = True
        cookie[self.settings.auth_session_cookie_name]["samesite"] = "Lax"
        cookie[self.settings.auth_session_cookie_name]["max-age"] = "0"
        if self.settings.auth_secure_cookies:
            cookie[self.settings.auth_session_cookie_name]["secure"] = True
        for morsel in cookie.values():
            self.send_header("Set-Cookie", morsel.OutputString())

    def _error(self, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST, code: str = "bad_request") -> None:
        self._send_json({"error": message, "code": code}, status)

    @classmethod
    def reset_rate_limits(cls) -> None:
        with cls._rate_limit_lock:
            cls._rate_limit_hits = {}

    def _client_ip(self) -> str:
        peer = str(self.client_address[0] if self.client_address else "")
        forwarded_for = str(self.headers.get("X-Forwarded-For", "") or "").split(",", 1)[0].strip()
        if peer in {"127.0.0.1", "::1"} and forwarded_for:
            return forwarded_for[:80]
        return peer[:80] or "unknown"

    def _rate_limit_key(self, scope: str, identifier: str = "") -> str:
        clean_identifier = identifier.strip().lower()[:160]
        return f"{scope}:{self._client_ip()}:{clean_identifier}"

    def _ensure_rate_limit(self, scope: str, *, identifier: str = "", limit: int | None = None) -> bool:
        max_hits = max(1, int(limit or 1))
        window = max(30, int(self.settings.auth_rate_limit_window_seconds))
        now = time.monotonic()
        cutoff = now - window
        key = self._rate_limit_key(scope, identifier)
        with self._rate_limit_lock:
            hits = [hit for hit in self._rate_limit_hits.get(key, []) if hit >= cutoff]
            if len(hits) >= max_hits:
                self._rate_limit_hits[key] = hits
                self._send_json(
                    {
                        "error": "Слишком много попыток. Подождите несколько минут и попробуйте снова.",
                        "code": "rate_limited",
                    },
                    HTTPStatus.TOO_MANY_REQUESTS,
                    {"Retry-After": str(window)},
                )
                return False
            hits.append(now)
            self._rate_limit_hits[key] = hits
        return True

    def _session_token(self) -> str:
        raw_cookie = str(self.headers.get("Cookie", "") or "")
        if not raw_cookie:
            return ""
        cookie = SimpleCookie()
        cookie.load(raw_cookie)
        morsel = cookie.get(self.settings.auth_session_cookie_name)
        return str(morsel.value) if morsel else ""

    def _session_user(self) -> AuthUser | None:
        if not self.settings.auth_enabled:
            return None
        try:
            self.auth.ensure_schema()
            return self.auth.user_for_session(self._session_token())
        except (AuthDatabaseUnavailable, RuntimeError):
            return None

    def _ensure_session_user(self) -> AuthUser | None:
        user = self._session_user()
        if user:
            return user
        self._send_json(
            {"error": "Нужно войти в аккаунт HolyMedia MCP.", "code": "session_required"},
            HTTPStatus.UNAUTHORIZED,
            {"WWW-Authenticate": 'Session realm="HolyMedia MCP"'},
        )
        return None

    def _ensure_admin_user(self) -> AuthUser | None:
        user = self._ensure_session_user()
        if not user:
            return None
        if not user.is_admin:
            self._error("Доступ к админ-панели есть только у администратора.", HTTPStatus.FORBIDDEN, "admin_required")
            return None
        return user

    def _ensure_api_authorized(self, route: str) -> bool:
        protected_route = route.startswith("/api/") or route == self.settings.mcp_route_path
        if not protected_route or not _api_token_required(self.settings):
            return True
        if route.startswith("/api/") and self._session_user():
            return True
        if not self.settings.web_api_token.strip():
            self._error(
                "Web API закрыт: AD_MCP_WEB_API_TOKEN не настроен на сервере.",
                HTTPStatus.SERVICE_UNAVAILABLE,
                "api_auth_not_configured",
            )
            return False
        if not _request_token_is_valid(self.headers, self.settings):
            self._send_json(
                {"error": "Нужен beta token для доступа к MCP web API.", "code": "api_auth_required"},
                HTTPStatus.UNAUTHORIZED,
                {"WWW-Authenticate": 'Bearer realm="HolyMedia MCP"'},
            )
            return False
        return True

    def _request_origin(self) -> str:
        origin = str(self.headers.get("Origin", "") or "").strip()
        if origin:
            return origin.rstrip("/").lower()
        referer = str(self.headers.get("Referer", "") or "").strip()
        if not referer:
            return ""
        parsed = urlparse(referer)
        if not parsed.scheme or not parsed.netloc:
            return ""
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/").lower()

    def _allowed_origins(self) -> set[str]:
        allowed: set[str] = set()
        for base_url in (self.settings.public_base_url.strip(), self.settings.public_base_or_local_web_url):
            if not base_url:
                continue
            parsed = urlparse(base_url)
            if parsed.scheme and parsed.netloc:
                allowed.add(f"{parsed.scheme}://{parsed.netloc}".rstrip("/").lower())
        host = str(self.headers.get("Host", "") or "").strip().lower()
        if host:
            allowed.add(f"http://{host}")
            allowed.add(f"https://{host}")
        return allowed

    def _ensure_same_origin_session_post(self, route: str) -> bool:
        if not route.startswith("/api/"):
            return True
        if _extract_request_token(self.headers):
            return True
        if not self._session_user():
            return True
        if self._request_origin() in self._allowed_origins():
            return True
        self._send_json(
            {
                "error": "Для действий через браузер нужна same-origin сессия. Повторите запрос из интерфейса HolyMedia MCP.",
                "code": "csrf_check_failed",
            },
            HTTPStatus.FORBIDDEN,
        )
        return False

    def _client_error_message(self, exc: Exception) -> str:
        if isinstance(exc, json.JSONDecodeError):
            return "Некорректный JSON в теле запроса."
        if isinstance(exc, KeyError):
            return f"Не хватает обязательного поля: {exc.args[0]}"
        text = redact_secret_text(str(exc).strip())
        if not text:
            return "Запрос не может быть выполнен."
        if len(text) > 320:
            return f"{text[:317]}..."
        return text

    def _client_error_code(self, exc: Exception) -> str:
        if isinstance(exc, json.JSONDecodeError):
            return "invalid_json"
        if isinstance(exc, KeyError):
            return "missing_field"
        if isinstance(exc, AuthValidationError):
            return "validation_error"
        return str(normalize_error(exc).get("code") or "bad_request")

    def _unexpected_error(self, operation: str, exc: Exception) -> None:
        request_id = uuid.uuid4().hex[:12]
        LOGGER.exception("Unhandled web UI error during %s %s request_id=%s", operation, redact_secret_text(self.path), request_id)
        self._send_json(
            {
                "error": "Непредвиденная ошибка web-layer. Проверьте логи сервера.",
                "code": "internal_error",
                "request_id": request_id,
            },
            HTTPStatus.BAD_GATEWAY,
        )
        return

    def _oauth_callback_response(self, provider: str, callback) -> None:
        query = self._query()
        wants_json = query.get("response") == "json"
        try:
            payload = callback(query)
        except (AdMCPError, ValueError, KeyError, json.JSONDecodeError, RuntimeError) as exc:
            if wants_json:
                raise
            return self._redirect(self.hosted.dashboard_oauth_return_url(provider, error=self._client_error_message(exc)))
        if wants_json:
            return self._send_json(payload)
        return self._redirect(self.hosted.dashboard_oauth_return_url(provider, payload=payload))

    def _query(self) -> dict[str, str]:
        parsed = urlparse(self.path)
        return {key: values[-1] for key, values in parse_qs(parsed.query).items() if values}

    def _oauth_base_url(self) -> str:
        return self.settings.public_base_or_local_web_url.rstrip("/")

    def _oauth_protected_resource_metadata(self) -> dict:
        base = self._oauth_base_url()
        return {
            "resource": self.settings.public_mcp_url,
            "resource_name": "HolyMedia MCP",
            "authorization_servers": [base],
            "scopes_supported": ["adforge:mcp"],
            "bearer_methods_supported": ["header"],
        }

    def _oauth_authorization_server_metadata(self) -> dict:
        base = self._oauth_base_url()
        return {
            "issuer": base,
            "authorization_endpoint": f"{base}/oauth/authorize",
            "token_endpoint": f"{base}/oauth/token",
            "registration_endpoint": f"{base}/oauth/register",
            "client_id_metadata_document_supported": True,
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none", "client_secret_basic"],
            "scopes_supported": ["adforge:mcp"],
        }

    def _form_body(self) -> dict[str, str]:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Некорректный Content-Length.") from exc
        if content_length <= 0:
            return {}
        if content_length > self.settings.web_max_body_bytes:
            raise ValueError("Тело запроса слишком большое.")
        raw = self.rfile.read(content_length).decode("utf-8")
        return {key: values[-1] for key, values in parse_qs(raw).items() if values}

    def _oauth_error_redirect(self, redirect_uri: str, error: str, state: str = "") -> None:
        if not redirect_uri:
            return self._send_json({"error": error}, HTTPStatus.BAD_REQUEST)
        payload = {"error": error}
        if state:
            payload["state"] = state
        separator = "&" if "?" in redirect_uri else "?"
        return self._redirect(f"{redirect_uri}{separator}{urlencode(payload)}")

    def _oauth_client_credentials_from_request(self, form: dict[str, str]) -> tuple[str, str]:
        client_id = str(form.get("client_id") or "").strip()
        client_secret = str(form.get("client_secret") or "").strip()
        header = str(self.headers.get("Authorization", "") or "").strip()
        if header.lower().startswith("basic "):
            import base64

            try:
                decoded = base64.b64decode(header[6:].encode("ascii")).decode("utf-8")
                basic_id, _, basic_secret = decoded.partition(":")
                return basic_id.strip(), basic_secret.strip()
            except Exception:  # noqa: BLE001
                return client_id, client_secret
        return client_id, client_secret

    def _json_body(self) -> dict:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Некорректный Content-Length.") from exc
        if content_length <= 0:
            return {}
        if content_length > self.settings.web_max_body_bytes:
            raise ValueError("Тело запроса слишком большое.")
        return json.loads(self.rfile.read(content_length).decode("utf-8"))

    def _raw_body(self, max_bytes: int) -> bytes:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Некорректный Content-Length.") from exc
        if content_length <= 0:
            raise ValueError("Файл не выбран.")
        if content_length > max_bytes:
            raise ValueError("Файл слишком большой.")
        return self.rfile.read(content_length)

    def _reset_url(self, token: str) -> str:
        return f"{self.settings.public_base_or_local_web_url}/reset-password?token={quote(token)}"

    def _extract_avatar_upload(self) -> tuple[str, str, bytes]:
        content_type = str(self.headers.get("Content-Type", "") or "")
        marker = "boundary="
        if "multipart/form-data" not in content_type or marker not in content_type:
            raise ValueError("Загрузите файл через multipart/form-data.")
        boundary = content_type.split(marker, 1)[1].strip().strip('"')
        if not boundary:
            raise ValueError("Некорректная форма загрузки.")
        body = self._raw_body(self.settings.profile_max_avatar_bytes + 16_384)
        boundary_bytes = f"--{boundary}".encode("utf-8")
        for part in body.split(boundary_bytes):
            part = part.strip(b"\r\n")
            if not part or part == b"--" or b"\r\n\r\n" not in part:
                continue
            header_bytes, content = part.split(b"\r\n\r\n", 1)
            if content.endswith(b"\r\n"):
                content = content[:-2]
            headers = header_bytes.decode("utf-8", errors="replace")
            if 'name="avatar"' not in headers:
                continue
            filename = ""
            for line in headers.splitlines():
                if not line.lower().startswith("content-disposition:"):
                    continue
                for item in line.split(";"):
                    item = item.strip()
                    if item.startswith("filename="):
                        filename = item.split("=", 1)[1].strip().strip('"')
                        break
            part_type = "application/octet-stream"
            for line in headers.splitlines():
                if line.lower().startswith("content-type:"):
                    part_type = line.split(":", 1)[1].strip().lower()
                    break
            return filename, part_type, content
        raise ValueError("Файл аватара не найден.")

    def _validate_avatar(self, filename: str, content_type: str, content: bytes) -> str:
        if not content:
            raise ValueError("Файл пустой.")
        if len(content) > self.settings.profile_max_avatar_bytes:
            raise ValueError("Файл слишком большой. Максимальный размер — 2 MB.")
        extension = Path(filename).suffix.lower()
        allowed = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }
        if extension not in allowed or content_type not in set(allowed.values()):
            raise ValueError("Поддерживаются только JPG, PNG или WEBP.")
        if allowed[extension] != content_type:
            raise ValueError("Расширение файла не совпадает с типом изображения.")
        if content_type == "image/jpeg" and not content.startswith(b"\xff\xd8\xff"):
            raise ValueError("Файл не похож на JPG изображение.")
        if content_type == "image/png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Файл не похож на PNG изображение.")
        if content_type == "image/webp" and not (len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"):
            raise ValueError("Файл не похож на WEBP изображение.")
        return ".jpg" if extension == ".jpeg" else extension

    def _store_avatar(self, user: AuthUser) -> dict:
        filename, content_type, content = self._extract_avatar_upload()
        extension = self._validate_avatar(filename, content_type, content)
        avatar_dir = self.settings.profile_upload_path / "avatars"
        avatar_dir.mkdir(parents=True, exist_ok=True)
        old_path = self.auth.avatar_path(user.id)
        safe_name = f"{user.id}_{uuid.uuid4().hex}{extension}"
        target = avatar_dir / safe_name
        target.write_bytes(content)
        try:
            if old_path:
                old = Path(old_path)
                if old.exists() and old.is_file() and old.parent == avatar_dir and old.name != safe_name:
                    old.unlink()
        except OSError:
            LOGGER.warning("Could not remove old avatar for user_id=%s", user.id)
        return self.auth.set_avatar(user.id, avatar_url=f"/uploads/avatars/{safe_name}", avatar_path=str(target))

    def do_HEAD(self) -> None:  # noqa: N802
        self._omit_response_body = True
        try:
            self.do_GET()
        finally:
            self._omit_response_body = False

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path
        try:
            if route in {"/", "/app", "/admin", "/login", "/register", "/reset-password"}:
                return self._send_file(STATIC_ROOT / "index.html", "text/html; charset=utf-8")
            if route == "/privacy":
                return self._send_file(STATIC_ROOT / "privacy.html", "text/html; charset=utf-8")
            if route == "/terms":
                return self._send_file(STATIC_ROOT / "terms.html", "text/html; charset=utf-8")
            if route.startswith("/uploads/avatars/"):
                return self._send_avatar_file(route.removeprefix("/uploads/avatars/"))
            if route in {"/health", "/healthz"}:
                return self._send_json({"status": "ok", "service": "adforge-mcp-web"})
            if route == "/ready":
                readiness = self.diagnostics.readiness()
                status = HTTPStatus.OK if readiness.get("status") == "ready" else HTTPStatus.SERVICE_UNAVAILABLE
                return self._send_json(readiness, status)
            if route in {"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"}:
                return self._send_json(self._oauth_protected_resource_metadata())
            if route in {"/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"}:
                return self._send_json(self._oauth_authorization_server_metadata())
            if route == "/auth/google/start":
                if not self.settings.auth_enabled:
                    return self._redirect("/?google_login_error=auth_disabled")
                if not self.google_login.configured():
                    return self._redirect("/?google_login_error=not_configured")
                return self._redirect(self.google_login.authorization_url(next_path="/app"))
            if route == self.settings.google_login_redirect_path:
                try:
                    profile = self.google_login.handle_callback(self._query())
                    self.auth.ensure_schema()
                    user, created = self.auth.find_or_create_google_user(email=profile["email"], name=profile.get("name", ""))
                    token, _session_id = self.auth.create_session(
                        user.id,
                        user_agent=str(self.headers.get("User-Agent", "")),
                        ip_address=str(self.client_address[0] if self.client_address else ""),
                    )
                except (GoogleLoginError, AuthValidationError, RuntimeError) as exc:
                    return self._redirect(f"/?google_login_error={quote(self._client_error_message(exc), safe='')}")
                return self._redirect_with_session(f"/app?google_login={'created' if created else 'login'}", token)
            if route == "/assets/app.css":
                return self._send_file(STATIC_ROOT / "app.css", "text/css; charset=utf-8")
            if route == "/assets/app.js":
                return self._send_file(STATIC_ROOT / "app.js", "application/javascript; charset=utf-8")
            if route == "/oauth/authorize":
                query = self._query()
                if query.get("response_type") != "code":
                    return self._oauth_error_redirect(query.get("redirect_uri", ""), "unsupported_response_type", query.get("state", ""))
                user = self._session_user()
                if not user:
                    return self._redirect(f"/?oauth_authorize={quote(self.path, safe='')}")
                self.auth.ensure_schema()
                try:
                    code = self.auth.create_mcp_oauth_authorization_code(
                        user,
                        client_id=str(query.get("client_id", "")),
                        redirect_uri=str(query.get("redirect_uri", "")),
                        scope=str(query.get("scope", "adforge:mcp")),
                        state=str(query.get("state", "")),
                        code_challenge=str(query.get("code_challenge", "")),
                        code_challenge_method=str(query.get("code_challenge_method", "")),
                    )
                except AuthValidationError as exc:
                    return self._oauth_error_redirect(str(query.get("redirect_uri", "")), "invalid_request", str(query.get("state", "")))
                redirect_uri = str(query.get("redirect_uri", ""))
                payload = {"code": code}
                if query.get("state"):
                    payload["state"] = str(query["state"])
                separator = "&" if "?" in redirect_uri else "?"
                return self._redirect(f"{redirect_uri}{separator}{urlencode(payload)}")
            if route == self.settings.meta_oauth_redirect_path:
                return self._oauth_callback_response("meta_ads", self.hosted.meta_oauth_callback)
            if route == self.settings.google_oauth_redirect_path:
                return self._oauth_callback_response("google_ads", lambda query: self.hosted.oauth_callback("google_ads", query))
            if route == self.settings.tiktok_oauth_redirect_path:
                return self._oauth_callback_response("tiktok_ads", lambda query: self.hosted.oauth_callback("tiktok_ads", query))
            if route == self.settings.yandex_oauth_redirect_path:
                return self._oauth_callback_response("yandex_direct", lambda query: self.hosted.oauth_callback("yandex_direct", query))
            if route == "/api/auth/me":
                user = self._session_user()
                if not user:
                    return self._send_json({"authenticated": False}, HTTPStatus.UNAUTHORIZED)
                return self._send_json({"authenticated": True, "user": user.public_dict()})
            if route == "/api/mcp-token":
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                return self._send_json({"token": self.auth.mcp_token_summary(user.id)})
            if route == "/api/mcp-oauth-client":
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                return self._send_json({"client": self.auth.mcp_oauth_client_summary(user.id)})
            if route == "/api/profile":
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                return self._send_json({"profile": self.auth.profile_summary(user.id)})
            if route == "/api/admin/users":
                if not self._ensure_admin_user():
                    return
                return self._send_json({"users": self.auth.list_users()})
            if route == "/api/admin/diagnostics":
                if not self._ensure_admin_user():
                    return
                return self._send_json(
                    {
                        "database": self.auth.diagnostics(),
                        "service": self.diagnostics.overview(live=False),
                        "oauth": self.hosted.oauth_diagnostics(),
                        "oauth_readiness": self.hosted.oauth_readiness(),
                        "security": self.diagnostics.security(),
                    }
                )

            if not self._ensure_api_authorized(route):
                return

            if route == self.settings.mcp_route_path:
                return self._send_json(self.hosted.mcp_transport_placeholder(), HTTPStatus.NOT_IMPLEMENTED)

            query = self._query()
            account_id = query.get("account_id")
            end_date = query.get("end_date")
            live_diagnostics = query.get("live", "").lower() in {"1", "true", "yes"}

            if route == "/api/diagnostics":
                return self._send_json(self.diagnostics.overview(live=live_diagnostics))
            if route == "/api/diagnostics/platforms":
                return self._send_json(self.diagnostics.platforms(live=live_diagnostics))
            if route.startswith("/api/diagnostics/platforms/"):
                provider = route.removeprefix("/api/diagnostics/platforms/").strip("/")
                return self._send_json(self.diagnostics.platform(provider, live=live_diagnostics))
            if route == "/api/diagnostics/connections":
                return self._send_json(self.diagnostics.connections())
            if route == "/api/diagnostics/mcp":
                return self._send_json(self.diagnostics.mcp())
            if route == "/api/diagnostics/security":
                return self._send_json(self.diagnostics.security())
            if route == "/api/beta/capabilities":
                return self._send_json(self.diagnostics.beta_capabilities())
            if route == "/api/hosted/mcp-connection":
                return self._send_json(self.hosted.mcp_connection_info())
            if route == "/api/hosted/connections":
                return self._send_json(self.hosted.connections(self._session_user()))
            if route == "/api/hosted/oauth/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics())
            if route == "/api/hosted/oauth/readiness":
                return self._send_json(self.hosted.oauth_readiness())
            if route == "/api/hosted/oauth/meta/start":
                return self._redirect(self.hosted.meta_oauth_redirect_url(self._session_user()))
            if route == "/api/hosted/oauth/meta/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("meta_ads"))
            if route == "/api/hosted/oauth/meta/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("meta_ads", self._session_user()))
            if route == "/api/hosted/oauth/meta/pending":
                return self._send_json(self.hosted.meta_oauth_pending(str(query["pending_id"]), self._session_user()))
            if route == "/api/hosted/oauth/google/start":
                return self._redirect(self.hosted.oauth_redirect_url("google_ads", self._session_user()))
            if route == "/api/hosted/oauth/google/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("google_ads"))
            if route == "/api/hosted/oauth/google/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("google_ads", self._session_user()))
            if route == "/api/hosted/oauth/google/pending":
                return self._send_json(self.hosted.oauth_pending("google_ads", str(query["pending_id"]), self._session_user()))
            if route == "/api/hosted/oauth/tiktok/start":
                return self._redirect(self.hosted.oauth_redirect_url("tiktok_ads", self._session_user()))
            if route == "/api/hosted/oauth/tiktok/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("tiktok_ads"))
            if route == "/api/hosted/oauth/tiktok/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("tiktok_ads", self._session_user()))
            if route == "/api/hosted/oauth/tiktok/pending":
                return self._send_json(self.hosted.oauth_pending("tiktok_ads", str(query["pending_id"]), self._session_user()))
            if route == "/api/hosted/oauth/yandex/start":
                return self._redirect(self.hosted.oauth_redirect_url("yandex_direct", self._session_user()))
            if route == "/api/hosted/oauth/yandex/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("yandex_direct"))
            if route == "/api/hosted/oauth/yandex/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("yandex_direct", self._session_user()))
            if route == "/api/hosted/oauth/yandex/pending":
                return self._send_json(self.hosted.oauth_pending("yandex_direct", str(query["pending_id"]), self._session_user()))

            if route == "/api/meta/dashboard":
                return self._send_json(self.service.dashboard(account_id=account_id, end_date=end_date))
            if route == "/api/meta/workspace":
                return self._send_json(self.service.workspace(account_id=account_id, end_date=end_date))
            if route == "/api/meta/data-contract":
                return self._send_json(self.service.data_contract())
            if route == "/api/meta/campaign-structure":
                return self._send_json(self.service.campaign_structure(account_id=account_id))
            if route == "/api/meta/delivery-issues":
                return self._send_json(self.service.delivery_issues(account_id=account_id, limit=int(query.get("limit", "20"))))
            if route == "/api/meta/assets":
                return self._send_json(self.service.connected_assets(account_id=account_id))
            if route == "/api/meta/top-performers":
                return self._send_json(
                    self.service.top_performers(
                        account_id=account_id,
                        end_date=end_date,
                        lookback_days=int(query.get("lookback_days", "7")),
                        entity_level=query.get("entity_level", "campaign"),
                        metric=query.get("metric", "cost_per_result"),
                        limit=int(query.get("limit", "5")),
                    )
                )
            if route == "/api/meta/no-result-entities":
                return self._send_json(
                    self.service.no_result_entities(
                        account_id=account_id,
                        end_date=end_date,
                        lookback_days=int(query.get("lookback_days", "7")),
                        entity_level=query.get("entity_level", "ad"),
                        min_spend=float(query.get("min_spend", "20")),
                        limit=int(query.get("limit", "10")),
                    )
                )
            if route == "/api/meta/config-diagnostics":
                return self._send_json(self.service.config_diagnostics())
            if route == "/api/meta/auth-diagnostics":
                return self._send_json(self.service.auth_diagnostics())
            if route == "/api/meta/persistence":
                return self._send_json(self.service.persistence_diagnostics())
            if route == "/api/meta/debug-health":
                return self._send_json(self.service.diagnostics_health())
            if route == "/api/meta/skills/catalog":
                return self._send_json(self.service.skill_catalog(account_id=account_id, end_date=end_date))
            if route == "/api/meta/skills/budget-summary":
                return self._send_json(self.service.summarize_budget_skill(account_id=account_id, end_date=end_date))
            if route == "/api/meta/skills/disable-candidates":
                return self._send_json(
                    self.service.disable_candidates_skill(
                        account_id=account_id,
                        end_date=end_date,
                        lookback_days=int(query.get("lookback_days", "7")),
                        entity_level=query.get("entity_level", "ad"),
                        min_spend=float(query.get("min_spend", "20")),
                        limit=int(query.get("limit", "10")),
                    )
                )
            if route == "/api/meta/skills/scale-candidates":
                return self._send_json(
                    self.service.scale_candidates_skill(
                        account_id=account_id,
                        end_date=end_date,
                        lookback_days=int(query.get("lookback_days", "7")),
                        entity_level=query.get("entity_level", "campaign"),
                        max_cost_per_result=float(query.get("max_cost_per_result", "20")),
                        min_conversions=float(query.get("min_conversions", "1")),
                        limit=int(query.get("limit", "10")),
                    )
                )
            if route == "/api/meta/skills/collect-report":
                return self._send_json(
                    self.service.collect_report_skill(
                        account_id=account_id,
                        end_date=end_date,
                        lookback_days=int(query.get("lookback_days", "7")),
                        entity_level=query.get("entity_level", "campaign"),
                        min_spend=float(query.get("min_spend", "20")),
                        max_cost_per_result=float(query.get("max_cost_per_result", "20")),
                    )
                )
        except (AdMCPError, ValueError, KeyError, json.JSONDecodeError, RuntimeError) as exc:
            return self._error(self._client_error_message(exc), code=self._client_error_code(exc))
        except Exception as exc:  # noqa: BLE001
            return self._unexpected_error("GET", exc)

        self._error("Route not found.", HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path
        try:
            if route == "/api/auth/register":
                payload = self._json_body()
                if not self.settings.auth_enabled:
                    return self._error("Регистрация временно отключена.", HTTPStatus.SERVICE_UNAVAILABLE, "auth_disabled")
                if not self._ensure_rate_limit(
                    "auth_register",
                    identifier=str(payload.get("email", "")),
                    limit=self.settings.auth_registration_rate_limit,
                ):
                    return
                registration_code = str(payload.get("access_code") or payload.get("registration_code") or "").strip()
                configured_code = self.settings.auth_registration_code.strip()
                if configured_code and not secrets.compare_digest(registration_code, configured_code):
                    return self._error("Неверный код регистрации.", HTTPStatus.FORBIDDEN, "registration_code_required")
                if not configured_code and not self.settings.auth_allow_public_registration:
                    return self._error("Публичная регистрация временно закрыта.", HTTPStatus.FORBIDDEN, "registration_closed")
                self.auth.ensure_schema()
                try:
                    user = self.auth.create_user(
                        email=str(payload.get("email", "")),
                        name=str(payload.get("name", "")),
                        password=str(payload.get("password", "")),
                        role="user",
                        status="active",
                    )
                except EmailAlreadyRegisteredError:
                    # Do not reveal whether the email already exists (enumeration).
                    return self._error(
                        "Не удалось создать аккаунт. Проверьте данные или обратитесь к администратору.",
                        HTTPStatus.BAD_REQUEST,
                        "registration_failed",
                    )
                token, _session_id = self.auth.create_session(
                    user.id,
                    user_agent=str(self.headers.get("User-Agent", "")),
                    ip_address=str(self.client_address[0] if self.client_address else ""),
                )
                return self._send_auth_json({"authenticated": True, "user": user.public_dict()}, session_token=token)
            if route == "/api/auth/login":
                payload = self._json_body()
                if not self.settings.auth_enabled:
                    return self._error("Вход временно отключён.", HTTPStatus.SERVICE_UNAVAILABLE, "auth_disabled")
                if not self._ensure_rate_limit("auth_login", identifier=str(payload.get("email", "")), limit=self.settings.auth_login_rate_limit):
                    return
                self.auth.ensure_schema()
                user = self.auth.authenticate(str(payload.get("email", "")), str(payload.get("password", "")))
                token, _session_id = self.auth.create_session(
                    user.id,
                    user_agent=str(self.headers.get("User-Agent", "")),
                    ip_address=str(self.client_address[0] if self.client_address else ""),
                )
                return self._send_auth_json({"authenticated": True, "user": user.public_dict()}, session_token=token)
            if route == "/api/auth/logout":
                if not self._ensure_same_origin_session_post(route):
                    return
                self.auth.revoke_session(self._session_token())
                return self._send_auth_json({"ok": True}, clear_session=True)
            if route == "/api/site/analyze":
                if not self._ensure_same_origin_session_post(route):
                    return
                if not self._ensure_session_user():
                    return
                payload = self._json_body()
                return self._send_json({"analysis": analyze_site_improvements(str(payload.get("url", "")))})
            if route == "/api/auth/forgot-password":
                payload = self._json_body()
                if not self.settings.auth_enabled:
                    return self._error("Восстановление доступа временно отключено.", HTTPStatus.SERVICE_UNAVAILABLE, "auth_disabled")
                if not self._ensure_rate_limit(
                    "auth_forgot_password",
                    identifier=str(payload.get("email", "")),
                    limit=self.settings.auth_password_reset_rate_limit,
                ):
                    return
                if not self.emailer.configured():
                    return self._send_json(
                        {"error": "Отправка письма временно недоступна. Обратитесь к администратору.", "code": "smtp_not_configured"},
                        HTTPStatus.SERVICE_UNAVAILABLE,
                    )
                self.auth.ensure_schema()
                reset = self.auth.create_password_reset_token(str(payload.get("email", "")))
                if reset:
                    user, raw_token = reset
                    try:
                        self.emailer.send_password_reset(
                            to_email=user.email,
                            reset_url=self._reset_url(raw_token),
                            ttl_minutes=self.settings.password_reset_ttl_minutes,
                        )
                    except EmailDeliveryError:
                        return self._send_json(
                            {"error": "Отправка письма временно недоступна. Обратитесь к администратору.", "code": "email_delivery_failed"},
                            HTTPStatus.SERVICE_UNAVAILABLE,
                        )
                return self._send_json(
                    {
                        "ok": True,
                        "message": "Если аккаунт с такой почтой существует, мы отправили ссылку для восстановления пароля.",
                    }
                )
            if route == "/api/auth/reset-password":
                payload = self._json_body()
                if not self.settings.auth_enabled:
                    return self._error("Восстановление доступа временно отключено.", HTTPStatus.SERVICE_UNAVAILABLE, "auth_disabled")
                if not self._ensure_rate_limit(
                    "auth_reset_password",
                    identifier=str(payload.get("token", ""))[:24],
                    limit=self.settings.auth_password_reset_rate_limit,
                ):
                    return
                self.auth.ensure_schema()
                user = self.auth.reset_password(
                    str(payload.get("token", "")),
                    str(payload.get("new_password", "")),
                    str(payload.get("confirm_password", "")),
                )
                return self._send_json({"ok": True, "email": user.email})
            if route == "/oauth/register":
                self.auth.ensure_schema()
                payload = self._json_body()
                result = self.auth.register_mcp_oauth_client(payload)
                return self._send_json(result, HTTPStatus.CREATED)
            if route == "/oauth/token":
                self.auth.ensure_schema()
                payload = self._form_body()
                if payload.get("grant_type") != "authorization_code":
                    return self._send_json({"error": "unsupported_grant_type"}, HTTPStatus.BAD_REQUEST)
                client_id, client_secret = self._oauth_client_credentials_from_request(payload)
                try:
                    result = self.auth.exchange_mcp_oauth_code(
                        client_id=client_id,
                        code=str(payload.get("code", "")),
                        redirect_uri=str(payload.get("redirect_uri", "")),
                        code_verifier=str(payload.get("code_verifier", "")),
                        client_secret=client_secret,
                    )
                except AuthInvalidClientError:
                    return self._send_json({"error": "invalid_client"}, HTTPStatus.UNAUTHORIZED)
                except AuthValidationError:
                    return self._send_json({"error": "invalid_grant"}, HTTPStatus.BAD_REQUEST)
                return self._send_json(result)
            if route == "/api/profile/change-password":
                if not self._ensure_same_origin_session_post(route):
                    return
                user = self._ensure_session_user()
                if not user:
                    return
                payload = self._json_body()
                if not self._ensure_rate_limit(
                    "auth_change_password",
                    identifier=user.id,
                    limit=self.settings.auth_password_change_rate_limit,
                ):
                    return
                self.auth.ensure_schema()
                self.auth.change_password(
                    user.id,
                    str(payload.get("current_password", "")),
                    str(payload.get("new_password", "")),
                    str(payload.get("confirm_password", "")),
                )
                return self._send_json({"ok": True})
            if route == "/api/profile/avatar":
                if not self._ensure_same_origin_session_post(route):
                    return
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                return self._send_json({"profile": self._store_avatar(user)})
            if route == "/api/mcp-token/create":
                if not self._ensure_same_origin_session_post(route):
                    return
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                result = self.auth.create_mcp_token(user)
                return self._send_json({"token": {key: value for key, value in result.items() if key != "raw_token"}, "raw_token": result["raw_token"]})
            if route == "/api/mcp-token/rotate":
                if not self._ensure_same_origin_session_post(route):
                    return
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                result = self.auth.rotate_mcp_token(user)
                return self._send_json({"token": {key: value for key, value in result.items() if key != "raw_token"}, "raw_token": result["raw_token"]})
            if route == "/api/mcp-token/revoke":
                if not self._ensure_same_origin_session_post(route):
                    return
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                return self._send_json({"token": self.auth.revoke_mcp_token(user.id)})
            if route == "/api/mcp-oauth-client/create":
                if not self._ensure_same_origin_session_post(route):
                    return
                user = self._ensure_session_user()
                if not user:
                    return
                self.auth.ensure_schema()
                result = self.auth.create_mcp_oauth_client_credentials(user)
                safe = {key: value for key, value in result.items() if key != "client_secret"}
                return self._send_json({"client": safe, "client_secret": result["client_secret"]})
            if route == "/api/admin/users/status":
                if not self._ensure_same_origin_session_post(route):
                    return
                if not self._ensure_admin_user():
                    return
                payload = self._json_body()
                user = self.auth.set_user_status(str(payload["user_id"]), str(payload["status"]))
                return self._send_json({"user": user})
            if route == "/api/admin/users/role":
                if not self._ensure_same_origin_session_post(route):
                    return
                if not self._ensure_admin_user():
                    return
                payload = self._json_body()
                user = self.auth.set_user_role(str(payload["user_id"]), str(payload["role"]))
                return self._send_json({"user": user})
            if route == "/api/admin/users/mcp-token/revoke":
                if not self._ensure_same_origin_session_post(route):
                    return
                if not self._ensure_admin_user():
                    return
                payload = self._json_body()
                self.auth.ensure_schema()
                return self._send_json({"token": self.auth.revoke_mcp_token(str(payload["user_id"]))})
            if not self._ensure_api_authorized(route):
                return
            if not self._ensure_same_origin_session_post(route):
                return
            payload = self._json_body()
            if route == "/api/hosted/connections/import-local":
                user = self._session_user()
                result = self.hosted.import_local_provider(str(payload["provider"]), user)
                if user:
                    self.auth.record_platform_connection(user, str(payload["provider"]), result.get("accounts", []))
                return self._send_json(result)
            if route == "/api/hosted/connections/disconnect":
                user = self._session_user()
                provider = str(payload["provider"])
                result = self.hosted.disconnect_provider(provider, user)
                if user:
                    self.auth.mark_platform_disconnected(user, provider)
                return self._send_json(result)
            if route == "/api/hosted/oauth/meta/select":
                user = self._session_user()
                result = self.hosted.meta_oauth_select(payload, user)
                if user:
                    self.auth.record_platform_connection(user, "meta_ads", result.get("accounts", []))
                return self._send_json(result)
            if route == "/api/hosted/oauth/google/select":
                user = self._session_user()
                result = self.hosted.oauth_select("google_ads", payload, user)
                if user:
                    self.auth.record_platform_connection(user, "google_ads", result.get("accounts", []))
                return self._send_json(result)
            if route == "/api/hosted/oauth/tiktok/select":
                user = self._session_user()
                result = self.hosted.oauth_select("tiktok_ads", payload, user)
                if user:
                    self.auth.record_platform_connection(user, "tiktok_ads", result.get("accounts", []))
                return self._send_json(result)
            if route == "/api/hosted/oauth/yandex/select":
                user = self._session_user()
                result = self.hosted.oauth_select("yandex_direct", payload, user)
                if user:
                    self.auth.record_platform_connection(user, "yandex_direct", result.get("accounts", []))
                return self._send_json(result)
            if route == "/api/meta/preview/clone-campaign":
                return self._send_json(
                    self.service.preview_clone_campaign(
                        source_campaign_id=str(payload["source_campaign_id"]),
                        new_name=payload.get("new_name"),
                        daily_budget=payload.get("daily_budget"),
                        lifetime_budget=payload.get("lifetime_budget"),
                        status=str(payload.get("status", "PAUSED")),
                        account_id=payload.get("account_id"),
                    )
                )
            if route == "/api/meta/preview/update-campaign-budget":
                return self._send_json(
                    self.service.preview_update_campaign_budget(
                        campaign_id=str(payload["campaign_id"]),
                        daily_budget=payload.get("daily_budget"),
                        lifetime_budget=payload.get("lifetime_budget"),
                        spend_cap=payload.get("spend_cap"),
                        budget_delta_percent=payload.get("budget_delta_percent"),
                        account_id=payload.get("account_id"),
                    )
                )
            if route == "/api/meta/preview/pause-ads":
                ids = payload.get("ids") or []
                return self._send_json(self.service.preview_pause_ads(ids=[str(item) for item in ids], account_id=payload.get("account_id")))
        except (AdMCPError, ValueError, KeyError, json.JSONDecodeError, RuntimeError) as exc:
            return self._error(self._client_error_message(exc), code=self._client_error_code(exc))
        except Exception as exc:  # noqa: BLE001
            return self._unexpected_error("POST", exc)

        self._error("Route not found.", HTTPStatus.NOT_FOUND)

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path
        try:
            if route == "/api/profile":
                if not self._ensure_same_origin_session_post(route):
                    return
                user = self._ensure_session_user()
                if not user:
                    return
                payload = self._json_body()
                self.auth.ensure_schema()
                profile = self.auth.update_profile(user.id, nickname=str(payload.get("nickname", "")))
                return self._send_json({"profile": profile})
        except (AdMCPError, ValueError, KeyError, json.JSONDecodeError, RuntimeError) as exc:
            return self._error(self._client_error_message(exc), code=self._client_error_code(exc))
        except Exception as exc:  # noqa: BLE001
            return self._unexpected_error("PUT", exc)

        self._error("Route not found.", HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


def main() -> None:
    settings = Settings()
    host = settings.web_host
    port = settings.web_port
    AdsWebHandler.settings = settings
    AdsWebHandler.diagnostics = DiagnosticsService(settings)
    AdsWebHandler.hosted = HostedConnectionService(settings)
    AdsWebHandler.service = MetaDashboardService(settings)
    AdsWebHandler.auth = AuthStore(settings)
    AdsWebHandler.emailer = PasswordResetEmailer(settings)
    AdsWebHandler.google_login = GoogleLoginService(settings)
    if _api_token_required(settings) and not settings.web_api_token.strip():
        LOGGER.warning("AD_MCP_WEB_API_TOKEN is required for beta/production web API access but is not configured.")
    server = ThreadingHTTPServer((host, port), AdsWebHandler)
    print(f"Meta MCP web UI running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
