from __future__ import annotations

import json
import logging
import secrets
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ad_mcp.core.errors import AdMCPError, normalize_error
from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.settings import Settings, is_network_exposed_host, is_strict_auth_env
from ad_mcp.web.auth_store import AuthDatabaseUnavailable, AuthStore, AuthUser, AuthValidationError
from ad_mcp.web.diagnostics import DiagnosticsService
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
    _omit_response_body = False

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

    def _redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self._set_default_headers()
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
            {"error": "Нужно войти в аккаунт AdForge MCP.", "code": "session_required"},
            HTTPStatus.UNAUTHORIZED,
            {"WWW-Authenticate": 'Session realm="AdForge MCP"'},
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
                {"WWW-Authenticate": 'Bearer realm="AdForge MCP"'},
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
                "error": "Для действий через браузер нужна same-origin сессия. Повторите запрос из интерфейса AdForge MCP.",
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
            if route in {"/", "/app", "/admin", "/login", "/register"}:
                return self._send_file(STATIC_ROOT / "index.html", "text/html; charset=utf-8")
            if route in {"/health", "/healthz"}:
                return self._send_json({"status": "ok", "service": "adforge-mcp-web"})
            if route == "/ready":
                readiness = self.diagnostics.readiness()
                status = HTTPStatus.OK if readiness.get("status") == "ready" else HTTPStatus.SERVICE_UNAVAILABLE
                return self._send_json(readiness, status)
            if route == "/assets/app.css":
                return self._send_file(STATIC_ROOT / "app.css", "text/css; charset=utf-8")
            if route == "/assets/app.js":
                return self._send_file(STATIC_ROOT / "app.js", "application/javascript; charset=utf-8")
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
                return self._send_json(self.hosted.connections())
            if route == "/api/hosted/oauth/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics())
            if route == "/api/hosted/oauth/meta/start":
                return self._redirect(self.hosted.meta_oauth_redirect_url())
            if route == "/api/hosted/oauth/meta/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("meta_ads"))
            if route == "/api/hosted/oauth/meta/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("meta_ads"))
            if route == "/api/hosted/oauth/meta/pending":
                return self._send_json(self.hosted.meta_oauth_pending(str(query["pending_id"])))
            if route == "/api/hosted/oauth/google/start":
                return self._redirect(self.hosted.oauth_redirect_url("google_ads"))
            if route == "/api/hosted/oauth/google/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("google_ads"))
            if route == "/api/hosted/oauth/google/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("google_ads"))
            if route == "/api/hosted/oauth/google/pending":
                return self._send_json(self.hosted.oauth_pending("google_ads", str(query["pending_id"])))
            if route == "/api/hosted/oauth/tiktok/start":
                return self._redirect(self.hosted.oauth_redirect_url("tiktok_ads"))
            if route == "/api/hosted/oauth/tiktok/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("tiktok_ads"))
            if route == "/api/hosted/oauth/tiktok/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("tiktok_ads"))
            if route == "/api/hosted/oauth/tiktok/pending":
                return self._send_json(self.hosted.oauth_pending("tiktok_ads", str(query["pending_id"])))
            if route == "/api/hosted/oauth/yandex/start":
                return self._redirect(self.hosted.oauth_redirect_url("yandex_direct"))
            if route == "/api/hosted/oauth/yandex/diagnostics":
                return self._send_json(self.hosted.oauth_diagnostics("yandex_direct"))
            if route == "/api/hosted/oauth/yandex/authorize-url":
                return self._send_json(self.hosted.oauth_authorization_info("yandex_direct"))
            if route == "/api/hosted/oauth/yandex/pending":
                return self._send_json(self.hosted.oauth_pending("yandex_direct", str(query["pending_id"])))

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
                registration_code = str(payload.get("access_code") or payload.get("registration_code") or "").strip()
                configured_code = self.settings.auth_registration_code.strip()
                if configured_code and not secrets.compare_digest(registration_code, configured_code):
                    return self._error("Неверный код регистрации.", HTTPStatus.FORBIDDEN, "registration_code_required")
                if not configured_code and not self.settings.auth_allow_public_registration:
                    return self._error("Публичная регистрация временно закрыта.", HTTPStatus.FORBIDDEN, "registration_closed")
                self.auth.ensure_schema()
                user = self.auth.create_user(
                    email=str(payload.get("email", "")),
                    name=str(payload.get("name", "")),
                    password=str(payload.get("password", "")),
                    role="user",
                    status="active",
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
                return self._send_json(self.hosted.import_local_provider(str(payload["provider"])))
            if route == "/api/hosted/connections/disconnect":
                return self._send_json(self.hosted.disconnect_provider(str(payload["provider"])))
            if route == "/api/hosted/oauth/meta/select":
                return self._send_json(self.hosted.meta_oauth_select(payload))
            if route == "/api/hosted/oauth/google/select":
                return self._send_json(self.hosted.oauth_select("google_ads", payload))
            if route == "/api/hosted/oauth/tiktok/select":
                return self._send_json(self.hosted.oauth_select("tiktok_ads", payload))
            if route == "/api/hosted/oauth/yandex/select":
                return self._send_json(self.hosted.oauth_select("yandex_direct", payload))
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
    if _api_token_required(settings) and not settings.web_api_token.strip():
        LOGGER.warning("AD_MCP_WEB_API_TOKEN is required for beta/production web API access but is not configured.")
    server = ThreadingHTTPServer((host, port), AdsWebHandler)
    print(f"Meta MCP web UI running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
