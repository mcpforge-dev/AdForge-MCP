from __future__ import annotations

import warnings
import base64
import hashlib

import pytest

from ad_mcp.http_server import create_http_app
from ad_mcp.mcp_auth import StaticBearerTokenVerifier, build_mcp_auth
from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore


def _test_client(app):
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient` is deprecated.*")
        from starlette.testclient import TestClient

    return TestClient(app)


@pytest.mark.asyncio
async def test_static_bearer_token_verifier_accepts_only_expected_token() -> None:
    verifier = StaticBearerTokenVerifier("secret-token")

    accepted = await verifier.verify_token("secret-token")
    rejected = await verifier.verify_token("wrong-token")

    assert accepted is not None
    assert accepted.client_id == "adforge-beta-client"
    assert rejected is None


def test_hosted_mcp_auth_requires_token_in_production(tmp_path) -> None:
    settings = Settings(project_root=tmp_path, env="production", web_api_token="")

    with pytest.raises(RuntimeError, match="AD_MCP_WEB_API_TOKEN"):
        build_mcp_auth(settings)


def test_hosted_mcp_auth_requires_token_in_beta(tmp_path) -> None:
    settings = Settings(project_root=tmp_path, env="beta", web_api_token="", mcp_http_host="127.0.0.1")

    with pytest.raises(RuntimeError, match="beta"):
        build_mcp_auth(settings)


def test_hosted_mcp_auth_requires_token_for_network_exposed_development_host(tmp_path) -> None:
    settings = Settings(project_root=tmp_path, env="development", web_api_token="", mcp_http_host="0.0.0.0")

    with pytest.raises(RuntimeError, match="network-exposed"):
        build_mcp_auth(settings)


def test_hosted_mcp_app_protects_mcp_route_with_bearer_token(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        mcp_http_host="0.0.0.0",
        connections_config="missing.yaml",
    )
    app = create_http_app(settings)

    with _test_client(app) as client:
        response = client.post(settings.mcp_route_path, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})

    assert response.status_code == 401


def test_hosted_mcp_app_allows_configured_public_host(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="beta",
        web_api_token="secret-token",
        public_base_url="https://adforge.example",
        mcp_public_url="https://adforge.example/mcp",
        mcp_http_host="127.0.0.1",
        connections_config="missing.yaml",
    )
    app = create_http_app(settings)

    with _test_client(app) as client:
        response = client.post(
            settings.mcp_route_path,
            headers={
                "Host": "adforge.example",
                "Authorization": "Bearer secret-token",
                "Accept": "application/json, text/event-stream",
            },
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )

    assert response.status_code != 421
    assert response.text != "Invalid Host header"


def test_hosted_mcp_app_exposes_configured_route(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="development",
        web_api_token="",
        mcp_endpoint_path="custom-mcp",
        mcp_http_host="127.0.0.1",
        connections_config="missing.yaml",
    )
    app = create_http_app(settings)
    paths = {getattr(route, "path", "") for route in app.routes}

    assert "/custom-mcp" in paths


def test_public_mcp_url_can_be_overridden_for_reverse_proxy(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        public_base_url="https://dashboard.example.com",
        mcp_public_url="https://mcp.example.com/custom-mcp",
        mcp_endpoint_path="/mcp",
    )

    assert settings.public_mcp_url == "https://mcp.example.com/custom-mcp"


@pytest.mark.asyncio
async def test_mcp_verifier_accepts_user_token_and_preserves_beta_fallback(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connections_config="missing.yaml",
    )
    store = AuthStore(settings)
    store.ensure_schema()
    user = store.create_user(email="client@example.com", name="Client", password="super-secret")
    raw_token = store.create_mcp_token(user)["raw_token"]
    _auth_settings, verifier = build_mcp_auth(settings)

    assert verifier is not None
    beta_access = await verifier.verify_token("secret-token")
    user_access = await verifier.verify_token(raw_token)
    wrong_access = await verifier.verify_token("wrong-token")

    assert beta_access is not None
    assert beta_access.client_id == "adforge-beta-client"
    assert user_access is not None
    assert user_access.client_id == f"adforge-user:{user.id}"
    assert wrong_access is None
    assert store.mcp_token_summary(user.id)["last_used_at"] is not None


@pytest.mark.asyncio
async def test_mcp_verifier_accepts_oauth_access_token(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connections_config="missing.yaml",
    )
    store = AuthStore(settings)
    store.ensure_schema()
    user = store.create_user(email="oauth@example.com", name="OAuth", password="super-secret")
    client = store.register_mcp_oauth_client(
        {
            "client_name": "Claude",
            "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
        }
    )
    verifier = "pkce-verifier-1234567890"
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    code = store.create_mcp_oauth_authorization_code(
        user,
        client_id=client["client_id"],
        redirect_uri="https://claude.ai/api/mcp/auth_callback",
        scope="adforge:mcp",
        state="state-1",
        code_challenge=challenge,
        code_challenge_method="S256",
    )
    token = store.exchange_mcp_oauth_code(
        client_id=client["client_id"],
        code=code,
        redirect_uri="https://claude.ai/api/mcp/auth_callback",
        code_verifier=verifier,
    )["access_token"]
    _auth_settings, token_verifier = build_mcp_auth(settings)

    assert token_verifier is not None
    access = await token_verifier.verify_token(token)

    assert access is not None
    assert access.client_id == f"adforge-user:{user.id}"


@pytest.mark.asyncio
async def test_mcp_verifier_rejects_revoked_and_disabled_user_tokens(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="secret-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        connections_config="missing.yaml",
    )
    store = AuthStore(settings)
    store.ensure_schema()
    revoked_user = store.create_user(email="revoked@example.com", name="Revoked", password="super-secret")
    disabled_user = store.create_user(email="disabled@example.com", name="Disabled", password="super-secret")
    revoked_token = store.create_mcp_token(revoked_user)["raw_token"]
    disabled_token = store.create_mcp_token(disabled_user)["raw_token"]
    store.revoke_mcp_token(revoked_user.id)
    store.set_user_status(disabled_user.id, "disabled")
    _auth_settings, verifier = build_mcp_auth(settings)

    assert verifier is not None
    assert await verifier.verify_token(revoked_token) is None
    assert await verifier.verify_token(disabled_token) is None
