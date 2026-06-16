from __future__ import annotations

import json
import logging
import secrets
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ad_mcp.core.errors import AdMCPError, normalize_error
from ad_mcp.core.redaction import redact_secret_text
from ad_mcp.settings import Settings, is_network_exposed_host, is_strict_auth_env
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
    _omit_response_body = False

    def _set_default_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("Vary", "Authorization")
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

    def _error(self, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST, code: str = "bad_request") -> None:
        self._send_json({"error": message, "code": code}, status)

    def _ensure_api_authorized(self, route: str) -> bool:
        protected_route = route.startswith("/api/") or route == self.settings.mcp_route_path
        if not protected_route or not _api_token_required(self.settings):
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
            if route == "/":
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
            if not self._ensure_api_authorized(route):
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
    if _api_token_required(settings) and not settings.web_api_token.strip():
        LOGGER.warning("AD_MCP_WEB_API_TOKEN is required for beta/production web API access but is not configured.")
    server = ThreadingHTTPServer((host, port), AdsWebHandler)
    print(f"Meta MCP web UI running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
