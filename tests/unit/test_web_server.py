from __future__ import annotations

import json
import base64
import hashlib
import sqlite3
import threading
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore
from ad_mcp.web.diagnostics import DiagnosticsService
from ad_mcp.web.emailer import PasswordResetEmailer
from ad_mcp.web.google_login import GoogleLoginService
from ad_mcp.web.hosted import HostedConnectionService
from ad_mcp.web.server import AdsWebHandler, _api_token_required, _extract_request_token, _request_token_is_valid
from ad_mcp.web.service import MetaDashboardService


class _Headers:
    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, key: str, default: str = "") -> str:
        return self._values.get(key, default)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, D401
        return None


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


def test_favicon_svg_is_publicly_served(tmp_path) -> None:
    settings = Settings(project_root=tmp_path, env="development", web_host="127.0.0.1", web_api_token="")
    base_url, close = _serve(settings)
    try:
        request = Request(f"{base_url}/favicon.svg")
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            body = response.read().decode("utf-8")
            content_type = response.headers.get("content-type", "")
    finally:
        close()

    assert response.status == 200
    assert "image/svg+xml" in content_type
    assert "HolyMedia MCP" in body


def test_favicon_png_is_publicly_served(tmp_path) -> None:
    settings = Settings(project_root=tmp_path, env="development", web_host="127.0.0.1", web_api_token="")
    base_url, close = _serve(settings)
    try:
        request = Request(f"{base_url}/favicon.png")
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            body = response.read()
            content_type = response.headers.get("content-type", "")
    finally:
        close()

    assert response.status == 200
    assert "image/png" in content_type
    assert body.startswith(b"\x89PNG")


def test_auth_login_rate_limit_blocks_repeated_failures(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        auth_login_rate_limit=2,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    store.create_user(email="client@example.com", name="Client", password="right-password")
    base_url, close = _serve(settings)
    try:
        first_status, first, _ = _post_json(base_url, "/api/auth/login", {"email": "client@example.com", "password": "wrong"})
        second_status, second, _ = _post_json(base_url, "/api/auth/login", {"email": "client@example.com", "password": "wrong-again"})
        blocked_status, blocked, _ = _post_json(base_url, "/api/auth/login", {"email": "client@example.com", "password": "right-password"})
    finally:
        close()

    assert first_status == 400
    assert second_status == 400
    assert first["code"] == second["code"] == "validation_error"
    assert blocked_status == 429
    assert blocked["code"] == "rate_limited"


def test_mcp_oauth_discovery_registration_authorize_and_token_flow(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        public_base_url="https://mcp.holymedia.kz",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    store.create_user(email="client@example.com", name="Client", password="right-password")
    base_url, close = _serve(settings)
    verifier = "pkce-verifier-1234567890"
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    redirect_uri = "https://claude.ai/api/mcp/auth_callback"
    try:
        prm_status, prm = _get_json(base_url, "/.well-known/oauth-protected-resource")
        metadata_status, metadata = _get_json(base_url, "/.well-known/oauth-authorization-server")
        register_status, client, _ = _post_json(
            base_url,
            "/oauth/register",
            {"client_name": "Claude", "redirect_uris": [redirect_uri]},
        )
        auth_path = "/oauth/authorize?" + urlencode(
            {
                "response_type": "code",
                "client_id": client["client_id"],
                "redirect_uri": redirect_uri,
                "scope": "adforge:mcp",
                "state": "state-1",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        unauth_status, unauth_location = _get_redirect_location(base_url, auth_path)
        login_status, _login_payload, cookie = _post_json(
            base_url,
            "/api/auth/login",
            {"email": "client@example.com", "password": "right-password"},
        )
        auth_status, auth_location = _get_redirect_location(base_url, auth_path, cookie)
        parsed = urlparse(auth_location)
        auth_query = parse_qs(parsed.query)
        code = auth_query["code"][0]
        token_status, token_payload = _post_form(
            base_url,
            "/oauth/token",
            {
                "grant_type": "authorization_code",
                "client_id": client["client_id"],
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            },
        )
        reuse_status, reuse_payload = _post_form(
            base_url,
            "/oauth/token",
            {
                "grant_type": "authorization_code",
                "client_id": client["client_id"],
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            },
        )
    finally:
        close()

    assert prm_status == 200
    assert prm["resource"] == "https://mcp.holymedia.kz/mcp"
    assert prm["authorization_servers"] == ["https://mcp.holymedia.kz"]
    assert metadata_status == 200
    assert metadata["registration_endpoint"] == "https://mcp.holymedia.kz/oauth/register"
    assert metadata["client_id_metadata_document_supported"] is True
    assert "S256" in metadata["code_challenge_methods_supported"]
    assert register_status == 201
    assert client["token_endpoint_auth_method"] == "none"
    assert unauth_status == 302
    assert unauth_location.startswith("/?oauth_authorize=")
    assert login_status == 200
    assert auth_status == 302
    assert parsed.scheme == "https"
    assert parsed.netloc == "claude.ai"
    assert auth_query["state"] == ["state-1"]
    assert token_status == 200
    assert token_payload["token_type"] == "Bearer"
    assert token_payload["access_token"].startswith("mcp_oauth_")
    assert reuse_status == 400
    assert reuse_payload["error"] == "invalid_grant"


def test_mcp_oauth_chatgpt_cimd_authorize_and_token_flow(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        public_base_url="https://mcp.holymedia.kz",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    store.create_user(email="client@example.com", name="Client", password="right-password")
    base_url, close = _serve(settings)
    verifier = "pkce-verifier-1234567890"
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    client_id = "https://chatgpt.com/connector/oauth/metadata/holymedia-mcp.json"
    redirect_uri = "https://chatgpt.com/connector/oauth/callback/holymedia-mcp"
    metadata_document = {
        "client_id": client_id,
        "client_name": "ChatGPT HolyMedia connector",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    try:
        login_status, _login_payload, cookie = _post_json(
            base_url,
            "/api/auth/login",
            {"email": "client@example.com", "password": "right-password"},
        )
        auth_path = "/oauth/authorize?" + urlencode(
            {
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "scope": "adforge:mcp",
                "state": "state-1",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        with patch(
            "ad_mcp.web.auth_store.AuthStore._fetch_oauth_client_metadata_document",
            return_value=metadata_document,
        ) as fetch_metadata:
            auth_status, auth_location = _get_redirect_location(base_url, auth_path, cookie)
        parsed = urlparse(auth_location)
        auth_query = parse_qs(parsed.query)
        code = auth_query["code"][0]
        token_status, token_payload = _post_form(
            base_url,
            "/oauth/token",
            {
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            },
        )
    finally:
        close()

    assert login_status == 200
    assert auth_status == 302
    fetch_metadata.assert_called_once_with(client_id)
    assert parsed.scheme == "https"
    assert parsed.netloc == "chatgpt.com"
    assert auth_query["state"] == ["state-1"]
    assert token_status == 200
    assert token_payload["token_type"] == "Bearer"
    assert token_payload["access_token"].startswith("mcp_oauth_")


def test_mcp_oauth_client_credentials_are_created_once_and_secret_is_not_relisted(tmp_path) -> None:
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
    store.create_user(email="client@example.com", name="Client", password="right-password")
    base_url, close = _serve(settings)
    verifier = "pkce-verifier-1234567890"
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    redirect_uri = "https://claude.ai/api/mcp/auth_callback"
    try:
        login_status, _login_payload, cookie = _post_json(
            base_url,
            "/api/auth/login",
            {"email": "client@example.com", "password": "right-password"},
        )
        create_status, created, _ = _post_json(base_url, "/api/mcp-oauth-client/create", {}, cookie, origin=base_url)
        summary_status, summary = _get_json_with_cookie(base_url, "/api/mcp-oauth-client", cookie)
        auth_path = "/oauth/authorize?" + urlencode(
            {
                "response_type": "code",
                "client_id": created["client"]["client_id"],
                "redirect_uri": redirect_uri,
                "scope": "adforge:mcp",
                "state": "state-1",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        auth_status, auth_location = _get_redirect_location(base_url, auth_path, cookie)
        code = parse_qs(urlparse(auth_location).query)["code"][0]
        missing_secret_status, missing_secret = _post_form(
            base_url,
            "/oauth/token",
            {
                "grant_type": "authorization_code",
                "client_id": created["client"]["client_id"],
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            },
        )
        auth_status_2, auth_location_2 = _get_redirect_location(base_url, auth_path, cookie)
        code_2 = parse_qs(urlparse(auth_location_2).query)["code"][0]
        token_status, token_payload = _post_form(
            base_url,
            "/oauth/token",
            {
                "grant_type": "authorization_code",
                "client_id": created["client"]["client_id"],
                "client_secret": created["client_secret"],
                "code": code_2,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            },
        )
    finally:
        close()

    assert login_status == 200
    assert create_status == 200
    assert created["client"]["client_id"].startswith("holymedia_claude_")
    assert created["client_secret"].startswith("mcp_oauth_secret_")
    assert summary_status == 200
    assert summary["client"]["client_id"] == created["client"]["client_id"]
    assert "client_secret" not in summary
    assert "client_secret" not in summary["client"]
    assert auth_status == 302
    assert missing_secret_status == 401
    assert missing_secret["error"] == "invalid_client"
    assert auth_status_2 == 302
    assert token_status == 200
    assert token_payload["access_token"].startswith("mcp_oauth_")


def test_google_login_callback_creates_or_reuses_user_session(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        public_base_url="https://mcp.holymedia.kz",
        google_login_client_id="google-login-client",
        google_login_client_secret="google-login-secret",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    existing = store.create_user(email="client@example.com", name="Client", password="right-password")
    base_url, close = _serve(settings)

    class _FakeGoogleLogin:
        def __init__(self) -> None:
            self.profiles = [
                {"email": "client@example.com", "name": "Client From Google"},
                {"email": "new@example.com", "name": "New Google User"},
            ]

        def configured(self) -> bool:
            return True

        def handle_callback(self, query: dict[str, str]) -> dict[str, str]:
            return self.profiles.pop(0)

    AdsWebHandler.google_login = _FakeGoogleLogin()  # type: ignore[assignment]
    try:
        existing_status, existing_location, existing_cookie = _get_redirect(base_url, "/auth/google/callback?code=ok&state=test")
        existing_me_status, existing_me = _get_json_with_cookie(base_url, "/api/auth/me", existing_cookie)
        new_status, new_location, new_cookie = _get_redirect(base_url, "/auth/google/callback?code=ok&state=test")
        new_me_status, new_me = _get_json_with_cookie(base_url, "/api/auth/me", new_cookie)
    finally:
        close()

    assert existing_status == 302
    assert existing_location == "/app?google_login=login"
    assert existing_me_status == 200
    assert existing_me["user"]["id"] == existing.id
    assert new_status == 302
    assert new_location == "/app?google_login=created"
    assert new_me_status == 200
    assert new_me["user"]["email"] == "new@example.com"
    assert new_me["user"]["workspace_id"] != existing.workspace_id


class _FakeEmailer(PasswordResetEmailer):
    def __init__(self, configured: bool = True) -> None:
        self._configured = configured
        self.messages: list[dict[str, object]] = []

    def configured(self) -> bool:
        return self._configured

    def send_password_reset(self, *, to_email: str, reset_url: str, ttl_minutes: int) -> None:
        self.messages.append({"to_email": to_email, "reset_url": reset_url, "ttl_minutes": ttl_minutes})


def _serve(settings: Settings, *, emailer: PasswordResetEmailer | None = None):
    previous = (
        AdsWebHandler.settings,
        AdsWebHandler.diagnostics,
        AdsWebHandler.hosted,
        AdsWebHandler.service,
        AdsWebHandler.auth,
        AdsWebHandler.emailer,
        AdsWebHandler.google_login,
    )
    AdsWebHandler.reset_rate_limits()
    AdsWebHandler.settings = settings
    AdsWebHandler.diagnostics = DiagnosticsService(settings)
    AdsWebHandler.hosted = HostedConnectionService(settings)
    AdsWebHandler.service = MetaDashboardService(settings)
    AdsWebHandler.auth = AuthStore(settings)
    AdsWebHandler.emailer = emailer or PasswordResetEmailer(settings)
    AdsWebHandler.google_login = GoogleLoginService(settings)
    server = ThreadingHTTPServer(("127.0.0.1", 0), AdsWebHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    def close() -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        (
            AdsWebHandler.settings,
            AdsWebHandler.diagnostics,
            AdsWebHandler.hosted,
            AdsWebHandler.service,
            AdsWebHandler.auth,
            AdsWebHandler.emailer,
            AdsWebHandler.google_login,
        ) = previous
        AdsWebHandler.reset_rate_limits()

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


def _post_json(
    base_url: str,
    path: str,
    payload: dict,
    cookie: str | None = None,
    *,
    origin: str | None = None,
    token: str | None = None,
) -> tuple[int, dict, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    if origin:
        headers["Origin"] = origin
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{base_url}{path}", data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8")), response.headers.get("Set-Cookie", "")
    except HTTPError as exc:
        body = exc.read().decode("utf-8")
        return exc.code, json.loads(body or "{}"), exc.headers.get("Set-Cookie", "")


def _post_form(base_url: str, path: str, payload: dict[str, str]) -> tuple[int, dict]:
    body = urlencode(payload).encode("utf-8")
    request = Request(
        f"{base_url}{path}",
        data=body,
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8") or "{}")


def _get_redirect_location(base_url: str, path: str, cookie: str | None = None) -> tuple[int, str]:
    headers = {"Accept": "*/*"}
    if cookie:
        headers["Cookie"] = cookie
    request = Request(f"{base_url}{path}", headers=headers)
    opener = build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, response.headers.get("Location", "")
    except HTTPError as exc:
        return exc.code, exc.headers.get("Location", "")


def _get_redirect(base_url: str, path: str, cookie: str | None = None) -> tuple[int, str, str]:
    headers = {"Accept": "*/*"}
    if cookie:
        headers["Cookie"] = cookie
    request = Request(f"{base_url}{path}", headers=headers)
    opener = build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, response.headers.get("Location", ""), response.headers.get("Set-Cookie", "")
    except HTTPError as exc:
        return exc.code, exc.headers.get("Location", ""), exc.headers.get("Set-Cookie", "")


def _put_json(base_url: str, path: str, payload: dict, cookie: str | None = None, *, origin: str | None = None) -> tuple[int, dict]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    if origin:
        headers["Origin"] = origin
    request = Request(f"{base_url}{path}", data=json.dumps(payload).encode("utf-8"), headers=headers, method="PUT")
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8") or "{}")


def _post_multipart_avatar(
    base_url: str,
    path: str,
    *,
    filename: str,
    content_type: str,
    content: bytes,
    cookie: str,
    origin: str,
) -> tuple[int, dict]:
    boundary = "----adforge-test-boundary"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="avatar"; filename="{filename}"\r\n'.encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            content,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    request = Request(
        f"{base_url}{path}",
        data=body,
        headers={
            "Accept": "application/json",
            "Cookie": cookie,
            "Origin": origin,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8") or "{}")


def _get_json_with_cookie(base_url: str, path: str, cookie: str) -> tuple[int, dict]:
    request = Request(f"{base_url}{path}", headers={"Accept": "application/json", "Cookie": cookie})
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _get_text(base_url: str, path: str) -> tuple[int, str]:
    request = Request(f"{base_url}{path}", headers={"Accept": "text/html"})
    try:
        with urlopen(request, timeout=5) as response:  # noqa: S310 - local unit-test server.
            return response.status, response.read().decode("utf-8")
    except HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


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


def test_legal_pages_are_public_and_linked_from_landing(tmp_path) -> None:
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
        landing_status, landing = _get_text(base_url, "/")
        privacy_status, privacy = _get_text(base_url, "/privacy")
        terms_status, terms = _get_text(base_url, "/terms")
        privacy_head_status, privacy_head_body = _head(base_url, "/privacy")
        terms_head_status, terms_head_body = _head(base_url, "/terms")
    finally:
        close()

    assert landing_status == privacy_status == terms_status == 200
    assert "/privacy" in landing
    assert "/terms" in landing
    assert "Политика конфиденциальности HolyMedia MCP" in privacy
    assert "Google Ads" in privacy
    assert "Meta Ads" in privacy
    assert "Условия использования HolyMedia MCP" in terms
    assert "Google Ads" in terms
    assert "Meta Ads" in terms
    assert privacy_head_status == terms_head_status == 200
    assert privacy_head_body == terms_head_body == b""


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
            origin=base_url,
        )
    finally:
        close()

    assert login_status == 200
    assert login["user"]["role"] == "admin"
    assert users_status == 200
    assert users["users"][0]["email"] == "admin@example.com"
    assert update_status == 200
    assert update["user"]["status"] == "disabled"


def test_session_post_requires_same_origin_for_logout(tmp_path) -> None:
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
        _status, _payload, cookie = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Client User", "email": "client@example.com", "password": "super-secret"},
        )
        blocked_status, blocked_payload, _ = _post_json(base_url, "/api/auth/logout", {}, cookie)
        ok_status, ok_payload, _ = _post_json(base_url, "/api/auth/logout", {}, cookie, origin=base_url)
    finally:
        close()

    assert blocked_status == 403
    assert blocked_payload["code"] == "csrf_check_failed"
    assert ok_status == 200
    assert ok_payload["ok"] is True


def test_user_mcp_token_lifecycle_returns_raw_only_once_and_stores_hash(tmp_path) -> None:
    database_path = tmp_path / "auth.db"
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{database_path.as_posix()}",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    base_url, close = _serve(settings)
    try:
        _status, _payload, cookie = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Client User", "email": "client@example.com", "password": "super-secret"},
        )
        empty_status, empty = _get_json_with_cookie(base_url, "/api/mcp-token", cookie)
        create_status, created, _ = _post_json(base_url, "/api/mcp-token/create", {}, cookie, origin=base_url)
        raw_token = created["raw_token"]
        after_create_status, after_create = _get_json_with_cookie(base_url, "/api/mcp-token", cookie)
        duplicate_status, duplicate, _ = _post_json(base_url, "/api/mcp-token/create", {}, cookie, origin=base_url)
        rotate_status, rotated, _ = _post_json(base_url, "/api/mcp-token/rotate", {}, cookie, origin=base_url)
        revoke_status, revoked, _ = _post_json(base_url, "/api/mcp-token/revoke", {}, cookie, origin=base_url)
    finally:
        close()

    assert empty_status == 200
    assert empty["token"]["exists"] is False
    assert create_status == 200
    assert raw_token.startswith("mcp_live_")
    assert created["token"]["exists"] is True
    assert created["token"]["status"] == "active"
    assert "raw_token" not in created["token"]
    assert after_create_status == 200
    assert "raw_token" not in after_create["token"]
    assert raw_token not in str(after_create)
    assert duplicate_status == 400
    assert duplicate["code"] == "validation_error"
    assert rotate_status == 200
    assert rotated["raw_token"].startswith("mcp_live_")
    assert rotated["raw_token"] != raw_token
    assert revoke_status == 200
    assert revoked["token"]["status"] == "revoked"

    with sqlite3.connect(database_path) as connection:
        rows = connection.execute("SELECT token_hash, token_prefix FROM mcp_access_tokens ORDER BY created_at").fetchall()
    assert len(rows) == 2
    assert all(len(row[0]) == 64 for row in rows)
    assert all(raw_token != row[0] for row in rows)
    assert any(raw_token.startswith(row[1]) for row in rows)


def test_hosted_connections_are_isolated_between_user_sessions_and_profile_counts(tmp_path) -> None:
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
    user_a = store.create_user(email="a@example.com", name="User A", password="super-secret")
    user_b = store.create_user(email="b@example.com", name="User B", password="super-secret")
    connection_store = HostedConnectionStore(settings.connection_store_file)
    pending_a = connection_store.save_oauth_pending(
        "tiktok_ads",
        [{"name": "TikTok A", "account_id": "tt_a", "advertiser_id": "tt_a"}],
        credentials={"access_token": "token-a"},
        workspace_id=user_a.workspace_id,
        user_id=user_a.id,
    )
    pending_b = connection_store.save_oauth_pending(
        "meta_ads",
        [{"name": "Meta B", "account_id": "act_b"}],
        credentials={"access_token": "token-b"},
        workspace_id=user_b.workspace_id,
        user_id=user_b.id,
    )
    base_url, close = _serve(settings)
    try:
        _login_a_status, _login_a, cookie_a = _post_json(base_url, "/api/auth/login", {"email": "a@example.com", "password": "super-secret"})
        _login_b_status, _login_b, cookie_b = _post_json(base_url, "/api/auth/login", {"email": "b@example.com", "password": "super-secret"})

        before_a_status, before_a = _get_json_with_cookie(base_url, "/api/hosted/connections", cookie_a)
        before_b_status, before_b = _get_json_with_cookie(base_url, "/api/hosted/connections", cookie_b)
        select_a_status, select_a, _ = _post_json(
            base_url,
            "/api/hosted/oauth/tiktok/select",
            {"pending_id": pending_a["pending_id"], "account_ids": ["tt_a"]},
            cookie_a,
            origin=base_url,
        )
        after_a_status, after_a = _get_json_with_cookie(base_url, "/api/hosted/connections", cookie_a)
        after_b_status, after_b = _get_json_with_cookie(base_url, "/api/hosted/connections", cookie_b)
        profile_a_status, profile_a = _get_json_with_cookie(base_url, "/api/profile", cookie_a)
        profile_b_status, profile_b = _get_json_with_cookie(base_url, "/api/profile", cookie_b)
        select_b_status, select_b, _ = _post_json(
            base_url,
            "/api/hosted/oauth/meta/select",
            {"pending_id": pending_b["pending_id"], "account_ids": ["act_b"]},
            cookie_b,
            origin=base_url,
        )
        final_a_status, final_a = _get_json_with_cookie(base_url, "/api/hosted/connections", cookie_a)
        final_b_status, final_b = _get_json_with_cookie(base_url, "/api/hosted/connections", cookie_b)
    finally:
        close()

    assert before_a_status == before_b_status == 200
    tiktok_a_before = next(platform for platform in before_a["platforms"] if platform["provider"] == "tiktok_ads")
    tiktok_b_before = next(platform for platform in before_b["platforms"] if platform["provider"] == "tiktok_ads")
    meta_b_before = next(platform for platform in before_b["platforms"] if platform["provider"] == "meta_ads")
    assert tiktok_a_before["pending_selections"][0]["pending_id"] == pending_a["pending_id"]
    assert tiktok_b_before["pending_selections"] == []
    assert meta_b_before["pending_selections"][0]["pending_id"] == pending_b["pending_id"]
    assert "token-a" not in str(before_a)
    assert "token-b" not in str(before_b)
    assert select_a_status == 200
    assert select_a["accounts"][0]["account_id"] == "tt_a"
    tiktok_a_after = next(platform for platform in after_a["platforms"] if platform["provider"] == "tiktok_ads")
    tiktok_b_after = next(platform for platform in after_b["platforms"] if platform["provider"] == "tiktok_ads")
    assert after_a_status == after_b_status == 200
    assert len(tiktok_a_after["accounts"]) == 1
    assert tiktok_b_after["accounts"] == []
    assert profile_a_status == profile_b_status == 200
    assert profile_a["profile"]["connected_ad_accounts_count"] == 1
    assert profile_b["profile"]["connected_ad_accounts_count"] == 0
    assert select_b_status == 200
    assert select_b["accounts"][0]["account_id"] == "act_b"
    meta_a_final = next(platform for platform in final_a["platforms"] if platform["provider"] == "meta_ads")
    meta_b_final = next(platform for platform in final_b["platforms"] if platform["provider"] == "meta_ads")
    assert final_a_status == final_b_status == 200
    assert meta_a_final["accounts"] == []
    assert len(meta_b_final["accounts"]) == 1


def test_admin_can_see_token_status_and_revoke_without_raw_token(tmp_path) -> None:
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
    admin = store.create_user(email="admin@example.com", name="Admin", password="super-secret", role="admin")
    client = store.create_user(email="client@example.com", name="Client", password="super-secret", role="user")
    raw_token = store.create_mcp_token(client)["raw_token"]
    base_url, close = _serve(settings)
    try:
        _login_status, _login, admin_cookie = _post_json(
            base_url,
            "/api/auth/login",
            {"email": admin.email, "password": "super-secret"},
        )
        users_status, users = _get_json_with_cookie(base_url, "/api/admin/users", admin_cookie)
        revoke_status, revoke, _ = _post_json(
            base_url,
            "/api/admin/users/mcp-token/revoke",
            {"user_id": client.id},
            admin_cookie,
            origin=base_url,
        )
        _client_login_status, _client_login, client_cookie = _post_json(
            base_url,
            "/api/auth/login",
            {"email": client.email, "password": "super-secret"},
        )
        forbidden_status, forbidden, _ = _post_json(
            base_url,
            "/api/admin/users/mcp-token/revoke",
            {"user_id": admin.id},
            client_cookie,
            origin=base_url,
        )
    finally:
        close()

    assert users_status == 200
    client_row = next(user for user in users["users"] if user["email"] == client.email)
    assert client_row["mcp_token_status"] == "active"
    assert client_row["active_mcp_tokens"] == 1
    assert raw_token not in str(users)
    assert revoke_status == 200
    assert revoke["token"]["status"] == "revoked"
    assert raw_token not in str(revoke)
    assert forbidden_status == 403
    assert forbidden["code"] == "admin_required"


def test_password_reset_flow_is_neutral_hashed_one_time_and_updates_password(tmp_path) -> None:
    database_path = tmp_path / "auth.db"
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{database_path.as_posix()}",
        public_base_url="https://adforge.example",
        smtp_host="smtp.example",
        smtp_from_email="noreply@example.com",
        password_reset_ttl_minutes=30,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    store.create_user(email="client@example.com", name="Client", password="old-password")
    emailer = _FakeEmailer(configured=True)
    base_url, close = _serve(settings, emailer=emailer)
    try:
        existing_status, existing, _ = _post_json(base_url, "/api/auth/forgot-password", {"email": "client@example.com"})
        unknown_status, unknown, _ = _post_json(base_url, "/api/auth/forgot-password", {"email": "unknown@example.com"})
        reset_url = str(emailer.messages[0]["reset_url"])
        reset_token = reset_url.split("token=", 1)[1]
        mismatch_status, mismatch, _ = _post_json(
            base_url,
            "/api/auth/reset-password",
            {"token": reset_token, "new_password": "new-password", "confirm_password": "different"},
        )
        reset_status, reset, _ = _post_json(
            base_url,
            "/api/auth/reset-password",
            {"token": reset_token, "new_password": "new-password", "confirm_password": "new-password"},
        )
        reused_status, reused, _ = _post_json(
            base_url,
            "/api/auth/reset-password",
            {"token": reset_token, "new_password": "another-password", "confirm_password": "another-password"},
        )
        old_login_status, old_login, _ = _post_json(base_url, "/api/auth/login", {"email": "client@example.com", "password": "old-password"})
        new_login_status, new_login, _ = _post_json(base_url, "/api/auth/login", {"email": "client@example.com", "password": "new-password"})
    finally:
        close()

    assert existing_status == 200
    assert unknown_status == 200
    assert existing["message"] == unknown["message"]
    assert len(emailer.messages) == 1
    assert "client@example.com" in str(emailer.messages[0]["to_email"])
    assert "reset_" in reset_url
    assert mismatch_status == 400
    assert mismatch["code"] == "validation_error"
    assert reset_status == 200
    assert reset["ok"] is True
    assert reused_status == 400
    assert reused["code"] == "validation_error"
    assert old_login_status == 400
    assert old_login["code"] == "validation_error"
    assert new_login_status == 200
    assert new_login["authenticated"] is True
    with sqlite3.connect(database_path) as connection:
        row = connection.execute("SELECT token_hash, used_at FROM password_reset_tokens").fetchone()
    assert reset_token not in row[0]
    assert len(row[0]) == 64
    assert row[1]


def test_forgot_password_rate_limit_blocks_email_flood(tmp_path) -> None:
    database_path = tmp_path / "auth.db"
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{database_path.as_posix()}",
        public_base_url="https://adforge.example",
        smtp_host="smtp.example",
        smtp_from_email="noreply@example.com",
        auth_password_reset_rate_limit=2,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    store.create_user(email="client@example.com", name="Client", password="old-password")
    emailer = _FakeEmailer(configured=True)
    base_url, close = _serve(settings, emailer=emailer)
    try:
        first_status, first, _ = _post_json(base_url, "/api/auth/forgot-password", {"email": "client@example.com"})
        second_status, second, _ = _post_json(base_url, "/api/auth/forgot-password", {"email": "client@example.com"})
        blocked_status, blocked, _ = _post_json(base_url, "/api/auth/forgot-password", {"email": "client@example.com"})
    finally:
        close()

    assert first_status == 200
    assert second_status == 200
    assert first["message"] == second["message"]
    assert blocked_status == 429
    assert blocked["code"] == "rate_limited"
    assert len(emailer.messages) == 2


def test_forgot_password_handles_missing_smtp_without_user_enumeration(tmp_path) -> None:
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
    store.create_user(email="client@example.com", name="Client", password="old-password")
    base_url, close = _serve(settings, emailer=_FakeEmailer(configured=False))
    try:
        existing_status, existing, _ = _post_json(base_url, "/api/auth/forgot-password", {"email": "client@example.com"})
        unknown_status, unknown, _ = _post_json(base_url, "/api/auth/forgot-password", {"email": "unknown@example.com"})
    finally:
        close()

    assert existing_status == 503
    assert unknown_status == 503
    assert existing["code"] == unknown["code"] == "smtp_not_configured"
    assert "SMTP" not in existing["error"]


def test_registration_with_existing_email_is_enumeration_safe(tmp_path) -> None:
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
        first_status, _first, _cookie = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Client User", "email": "client@example.com", "password": "super-secret"},
        )
        dup_status, dup, _ = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Another", "email": "client@example.com", "password": "super-secret"},
        )
    finally:
        close()

    assert first_status == 200
    assert dup_status == 400
    assert dup["code"] == "registration_failed"
    # The client must not learn that the email already exists.
    assert "существ" not in dup["error"].lower()
    assert "exist" not in dup["error"].lower()


def test_registration_requires_code_when_configured(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        auth_registration_code="beta-invite-code-123",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    base_url, close = _serve(settings)
    try:
        no_code_status, no_code, _ = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "No Code", "email": "nocode@example.com", "password": "super-secret"},
        )
        wrong_code_status, wrong_code, _ = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Wrong", "email": "wrong@example.com", "password": "super-secret", "access_code": "nope"},
        )
        ok_status, ok_payload, ok_cookie = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Valid", "email": "valid@example.com", "password": "super-secret", "access_code": "beta-invite-code-123"},
        )
    finally:
        close()

    assert no_code_status == 403
    assert no_code["code"] == "registration_code_required"
    assert wrong_code_status == 403
    assert wrong_code["code"] == "registration_code_required"
    assert ok_status == 200
    assert ok_payload["user"]["email"] == "valid@example.com"
    assert "adforge_session=" in ok_cookie


def test_password_reset_token_expires(tmp_path) -> None:
    database_path = tmp_path / "auth.db"
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{database_path.as_posix()}",
        password_reset_ttl_minutes=30,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = AuthStore(settings)
    store.ensure_schema()
    store.create_user(email="client@example.com", name="Client", password="old-password")
    reset = store.create_password_reset_token("client@example.com")
    assert reset is not None
    _user, raw_token = reset
    with sqlite3.connect(database_path) as connection:
        connection.execute("UPDATE password_reset_tokens SET expires_at = '2000-01-01T00:00:00Z'")
        connection.commit()

    try:
        store.reset_password(raw_token, "new-password", "new-password")
    except Exception as exc:  # noqa: BLE001
        assert "истёк" in str(exc)
    else:  # pragma: no cover - explicit failure path.
        raise AssertionError("Expired reset token should be rejected.")


def test_profile_update_change_password_and_safe_fields(tmp_path) -> None:
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
        _status, _payload, cookie = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Client User", "email": "client@example.com", "password": "old-password"},
        )
        profile_status, profile = _get_json_with_cookie(base_url, "/api/profile", cookie)
        empty_status, empty = _put_json(base_url, "/api/profile", {"nickname": ""}, cookie, origin=base_url)
        long_status, long_payload = _put_json(base_url, "/api/profile", {"nickname": "x" * 81}, cookie, origin=base_url)
        update_status, update = _put_json(base_url, "/api/profile", {"nickname": "New Nick"}, cookie, origin=base_url)
        wrong_status, wrong, _ = _post_json(
            base_url,
            "/api/profile/change-password",
            {"current_password": "wrong", "new_password": "new-password", "confirm_password": "new-password"},
            cookie,
            origin=base_url,
        )
        mismatch_status, mismatch, _ = _post_json(
            base_url,
            "/api/profile/change-password",
            {"current_password": "old-password", "new_password": "new-password", "confirm_password": "different"},
            cookie,
            origin=base_url,
        )
        change_status, changed, _ = _post_json(
            base_url,
            "/api/profile/change-password",
            {"current_password": "old-password", "new_password": "new-password", "confirm_password": "new-password"},
            cookie,
            origin=base_url,
        )
        login_status, login, _ = _post_json(base_url, "/api/auth/login", {"email": "client@example.com", "password": "new-password"})
    finally:
        close()

    assert profile_status == 200
    assert profile["profile"]["email"] == "client@example.com"
    assert "role" not in profile["profile"]
    assert "workspace" not in str(profile["profile"]).lower()
    assert empty_status == 400
    assert long_status == 400
    assert empty["code"] == long_payload["code"] == "validation_error"
    assert update_status == 200
    assert update["profile"]["nickname"] == "New Nick"
    assert wrong_status == 400
    assert "Текущий пароль" in wrong["error"]
    assert mismatch_status == 400
    assert mismatch["code"] == "validation_error"
    assert change_status == 200
    assert changed["ok"] is True
    assert login_status == 200
    assert login["authenticated"] is True


def test_avatar_upload_accepts_safe_image_and_rejects_unsafe_files(tmp_path) -> None:
    upload_dir = tmp_path / "uploads"
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        profile_upload_dir=str(upload_dir),
        profile_max_avatar_bytes=64,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 16
    html = b"<html><script>alert(1)</script></html>"
    base_url, close = _serve(settings)
    try:
        _status, _payload, cookie = _post_json(
            base_url,
            "/api/auth/register",
            {"name": "Client User", "email": "client@example.com", "password": "old-password"},
        )
        ok_status, ok = _post_multipart_avatar(
            base_url,
            "/api/profile/avatar",
            filename="avatar.png",
            content_type="image/png",
            content=png,
            cookie=cookie,
            origin=base_url,
        )
        svg_status, svg = _post_multipart_avatar(
            base_url,
            "/api/profile/avatar",
            filename="bad.svg",
            content_type="image/svg+xml",
            content=b"<svg></svg>",
            cookie=cookie,
            origin=base_url,
        )
        html_status, html_payload = _post_multipart_avatar(
            base_url,
            "/api/profile/avatar",
            filename="bad.png",
            content_type="image/png",
            content=html,
            cookie=cookie,
            origin=base_url,
        )
        large_status, large = _post_multipart_avatar(
            base_url,
            "/api/profile/avatar",
            filename="large.png",
            content_type="image/png",
            content=b"\x89PNG\r\n\x1a\n" + b"x" * 100,
            cookie=cookie,
            origin=base_url,
        )
    finally:
        close()

    assert ok_status == 200
    avatar_url = ok["profile"]["avatar_url"]
    assert avatar_url.startswith("/uploads/avatars/")
    assert "avatar.png" not in avatar_url
    stored = list((upload_dir / "avatars").glob("*.png"))
    assert len(stored) == 1
    assert svg_status == 400
    assert html_status == 400
    assert large_status == 400
    assert "Поддерживаются" in svg["error"]
    assert "PNG" in html_payload["error"]
    assert "слишком большой" in large["error"].lower()


def test_security_capabilities_expose_account_flags_without_secrets(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        smtp_host="smtp.example",
        smtp_username="smtp-user",
        smtp_password="smtp-password",
        smtp_from_email="noreply@example.com",
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    base_url, close = _serve(settings)
    try:
        capabilities_status, capabilities = _get_json(base_url, "/api/beta/capabilities", "secret-token")
        security_status, security = _get_json(base_url, "/api/diagnostics/security", "secret-token")
    finally:
        close()

    assert capabilities_status == 200
    assert capabilities["account"]["profile_editing_enabled"] is True
    assert capabilities["account"]["avatar_upload_enabled"] is True
    assert capabilities["account"]["password_change_enabled"] is True
    assert capabilities["account"]["password_reset_enabled"] is True
    assert security_status == 200
    assert security["smtp_configured"] is True
    assert security["auth_rate_limit_enabled"] is True
    assert "auth_rate_limit_enabled" in capabilities["security"]
    assert "public_registration_enabled" in capabilities["account"]
    assert "smtp-password" not in str(capabilities)
    assert "smtp-password" not in str(security)
