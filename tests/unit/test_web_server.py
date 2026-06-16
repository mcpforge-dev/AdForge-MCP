from __future__ import annotations

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore
from ad_mcp.web.diagnostics import DiagnosticsService
from ad_mcp.web.hosted import HostedConnectionService
from ad_mcp.web.server import AdsWebHandler, _api_token_required, _extract_request_token, _request_token_is_valid
from ad_mcp.web.service import MetaDashboardService


class _Headers:
    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, key: str, default: str = "") -> str:
        return self._values.get(key, default)


def test_api_token_not_required_for_development_without_token() -> None:
    settings = Settings(env="development", web_host="127.0.0.1", web_api_token="")

    assert _api_token_required(settings) is False
    assert _request_token_is_valid(_Headers({}), settings) is True


def test_api_token_required_for_network_exposed_development_host() -> None:
    settings = Settings(env="development", web_host="0.0.0.0", web_api_token="")

    assert _api_token_required(settings) is True
    assert _request_token_is_valid(_Headers({}), settings) is False


def test_api_token_required_for_production_even_when_missing() -> None:
    settings = Settings(env="production", web_api_token="")

    assert _api_token_required(settings) is True
    assert _request_token_is_valid(_Headers({}), settings) is False


def test_api_token_required_for_beta_even_when_missing() -> None:
    settings = Settings(env="beta", web_host="127.0.0.1", web_api_token="")

    assert _api_token_required(settings) is True
    assert _request_token_is_valid(_Headers({}), settings) is False


def test_bearer_token_authorizes_request() -> None:
    settings = Settings(env="production", web_api_token="secret-token")

    assert _extract_request_token(_Headers({"Authorization": "Bearer secret-token"})) == "secret-token"
    assert _request_token_is_valid(_Headers({"Authorization": "Bearer secret-token"}), settings) is True
    assert _request_token_is_valid(_Headers({"Authorization": "Bearer wrong-token"}), settings) is False


def test_custom_beta_token_header_authorizes_request() -> None:
    settings = Settings(env="production", web_api_token="secret-token")

    assert _extract_request_token(_Headers({"X-AD-MCP-BETA-TOKEN": "secret-token"})) == "secret-token"
    assert _request_token_is_valid(_Headers({"X-AD-MCP-BETA-TOKEN": "secret-token"}), settings) is True


def _serve(settings: Settings):
    previous = (AdsWebHandler.settings, AdsWebHandler.diagnostics, AdsWebHandler.hosted, AdsWebHandler.service, AdsWebHandler.auth)
    AdsWebHandler.settings = settings
    AdsWebHandler.diagnostics = DiagnosticsService(settings)
    AdsWebHandler.hosted = HostedConnectionService(settings)
    AdsWebHandler.service = MetaDashboardService(settings)
    AdsWebHandler.auth = AuthStore(settings)
    server = ThreadingHTTPServer(("127.0.0.1", 0), AdsWebHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    def close() -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        AdsWebHandler.settings, AdsWebHandler.diagnostics, AdsWebHandler.hosted, AdsWebHandler.service, AdsWebHandler.auth = previous

    return base_url, close


def _get_json(base_url: str, path: str, token: str | None = None) -> tuple[int, dict]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{base_url}{path}", headers=headers)
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))


def _post_json(base_url: str, path: str, payload: dict, cookie: str | None = None) -> tuple[int, dict, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    request = Request(f"{base_url}{path}", data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8")), response.headers.get("Set-Cookie", "")
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        return exc.code, json.loads(body or "{}"), exc.headers.get("Set-Cookie", "")


def _get_json_with_cookie(base_url: str, path: str, cookie: str) -> tuple[int, dict]:
    request = Request(f"{base_url}{path}", headers={"Accept": "application/json", "Cookie": cookie})
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _head(base_url: str, path: str, token: str | None = None) -> tuple[int, bytes]:
    headers = {"Accept": "*/*"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{base_url}{path}", headers=headers, method="HEAD")
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, response.read()
    except HTTPError as exc:
        return exc.code, exc.read()


def test_sensitive_endpoints_require_beta_token_and_health_is_public(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        public_base_url="https://adforge.example",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    base_url, close = _serve(settings)
    try:
        health_status, health = _get_json(base_url, "/health")
        ready_status, ready = _get_json(base_url, "/ready")
        missing_status, missing = _get_json(base_url, "/api/diagnostics")
        invalid_status, invalid = _get_json(base_url, "/api/diagnostics", "wrong-token")
        pending_status, pending = _get_json(base_url, "/api/hosted/oauth/meta/pending?pending_id=not-real")
        capabilities_missing_status, capabilities_missing = _get_json(base_url, "/api/beta/capabilities")
        capabilities_status, capabilities = _get_json(base_url, "/api/beta/capabilities", "secret-token")
        ok_status, diagnostics = _get_json(base_url, "/api/diagnostics", "secret-token")
    finally:
        close()

    assert health_status == 200
    assert health["status"] == "ok"
    assert ready_status == 200
    assert "secret-token" not in str(ready)
    assert missing_status == 401
    assert missing["code"] == "api_auth_required"
    assert invalid_status == 401
    assert invalid["code"] == "api_auth_required"
    assert pending_status == 401
    assert pending["code"] == "api_auth_required"
    assert capabilities_missing_status == 401
    assert capabilities_missing["code"] == "api_auth_required"
    assert capabilities_status == 200
    assert capabilities["mode"] == "hosted_beta"
    assert capabilities["security"]["tokens_returned"] is False
    assert "secret-token" not in str(capabilities)
    assert ok_status == 200
    assert diagnostics["security"]["beta_token_configured"] is True


def test_head_requests_return_headers_without_body(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        public_base_url="https://adforge.example",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    base_url, close = _serve(settings)
    try:
        paths = ["/", "/health", "/ready", "/assets/app.js", "/assets/app.css"]
        results = [_head(base_url, path) for path in paths]
        protected_status, protected_body = _head(base_url, "/api/diagnostics")
    finally:
        close()

    assert all(status == 200 for status, _body in results)
    assert all(body == b"" for _status, body in results)
    assert protected_status == 401
    assert protected_body == b""


def test_email_registration_creates_session_and_authorizes_dashboard_api(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    base_url, close = _serve(settings)
    try:
        status, payload, cookie = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Client User", "email": "client@example.com", "password": "super-secret"},
        )
        me_status, me = _get_json_with_cookie(base_url, "/api/auth/me", cookie)
        capabilities_status, capabilities = _get_json_with_cookie(base_url, "/api/beta/capabilities", cookie)
        admin_status, admin_payload = _get_json_with_cookie(base_url, "/api/admin/users", cookie)
    finally:
        close()

    assert status == 200
    assert payload["user"]["email"] == "client@example.com"
    assert "adforge_session=" in cookie
    assert "super-secret" not in str(payload)
    assert me_status == 200
    assert me["authenticated"] is True
    assert capabilities_status == 200
    assert capabilities["security"]["tokens_returned"] is False
    assert admin_status == 403
    assert admin_payload["code"] == "admin_required"


def test_admin_session_can_list_users_and_toggle_status(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    store.create_user(email="admin@example.com", name="Admin", password="super-secret", role="admin")
    base_url, close = _serve(settings)
    try:
        login_status, login, cookie = _post_json(
            base_url,
            "/api/auth/login",
            {"email": "admin@example.com", "password": "super-secret"},
        )
        users_status, users = _get_json_with_cookie(base_url, "/api/admin/users", cookie)
        target_id = users["users"][0]["id"]
        update_status, update, _ = _post_json(
            base_url,
            "/api/admin/users/status",
            {"user_id": target_id, "status": "disabled"},
            cookie,
        )
    finally:
        close()

    assert login_status == 200
    assert login["user"]["role"] == "admin"
    assert users_status == 200
    assert users["users"][0]["email"] == "admin@example.com"
    assert update_status == 200
    assert update["user"]["status"] == "disabled"
