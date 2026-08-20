import pytest

from ad_mcp.mcp_auth import MCP_READ_SCOPE, StaticBearerTokenVerifier
from ad_mcp.runtime_context import (
    current_mcp_access,
    current_workspace_id,
    ensure_current_mcp_tool_access,
    set_current_workspace_id,
)
from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore


@pytest.mark.asyncio
async def test_personal_mcp_token_sets_workspace_context_and_unmapped_legacy_token_is_denied(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="beta-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
    )
    store = AuthStore(settings)
    store.ensure_schema()
    user = store.create_user(email="client@example.com", name="Client", password="super-secret")
    raw_token = store.create_mcp_token(user)["raw_token"]
    verifier = StaticBearerTokenVerifier("beta-token", settings=settings, auth_store=store)

    personal_access = await verifier.verify_token(raw_token)
    personal_workspace_id = current_workspace_id()
    beta_access = await verifier.verify_token("beta-token")
    beta_workspace_id = current_workspace_id()
    invalid_access = await verifier.verify_token("wrong-token")

    assert personal_access is not None
    assert personal_access.client_id == f"adforge-user:{user.id}"
    assert personal_workspace_id == user.workspace_id
    assert beta_access is None
    assert beta_workspace_id is None
    assert invalid_access is None


@pytest.mark.asyncio
async def test_invalid_mcp_token_does_not_reuse_previous_workspace_context(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="beta-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
    )
    verifier = StaticBearerTokenVerifier("beta-token", settings=settings)
    set_current_workspace_id("stale-workspace")

    access = await verifier.verify_token("wrong-token")

    assert access is None
    assert current_workspace_id() is None


@pytest.mark.asyncio
async def test_service_mcp_token_sets_read_only_account_scope(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="beta-token",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
    )
    store = AuthStore(settings)
    store.ensure_schema()
    user = store.create_user(email="owner@example.com", name="Owner", password="super-secret")
    created = store.create_mcp_service_token(
        workspace_id=str(user.workspace_id),
        allowed_accounts={"google_ads": ["1234567890"]},
        name="Hermes",
    )
    verifier = StaticBearerTokenVerifier("beta-token", settings=settings, auth_store=store)

    access_token = await verifier.verify_token(created["raw_token"])
    access = current_mcp_access()

    assert access_token is not None
    assert access_token.client_id.startswith("adforge-service:")
    assert MCP_READ_SCOPE in access_token.scopes
    assert access is not None
    assert access.token_kind == "service"
    assert access.workspace_id == user.workspace_id
    assert access.read_only is True
    assert access.allowed_accounts == {"google_ads": frozenset({"1234567890"})}
    assert created["expires_at"]


@pytest.mark.asyncio
async def test_legacy_token_is_scoped_and_cannot_access_unlisted_account(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        web_api_token="beta-token",
        legacy_mcp_token_enabled=True,
        legacy_mcp_workspace_id="workspace-a",
        legacy_mcp_allowed_accounts_json='{"google_ads":["1234567890"]}',
    )
    verifier = StaticBearerTokenVerifier("beta-token", settings=settings)

    access_token = await verifier.verify_token("beta-token")
    access = current_mcp_access()

    assert access_token is not None
    assert access_token.client_id == "adforge-legacy-scoped-client"
    assert access is not None
    assert access.token_kind == "legacy"
    assert access.workspace_id == "workspace-a"
    ensure_current_mcp_tool_access(provider="google_ads", account_id="1234567890")
    with pytest.raises(PermissionError):
        ensure_current_mcp_tool_access(provider="google_ads", account_id="9999999999")
    with pytest.raises(PermissionError):
        ensure_current_mcp_tool_access(provider="google_ads", account_id="1234567890", write=True)


def test_expired_service_token_is_rejected(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        env="production",
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
    )
    store = AuthStore(settings)
    store.ensure_schema()
    user = store.create_user(email="expiry@example.com", name="Expiry", password="super-secret")
    created = store.create_mcp_service_token(
        workspace_id=str(user.workspace_id),
        allowed_accounts={"google_ads": ["1234567890"]},
        ttl_seconds=60,
    )
    with store._connect() as connection:  # noqa: SLF001 - migration regression fixture.
        store._execute(
            connection,
            "UPDATE mcp_service_tokens SET expires_at = ? WHERE id = ?",
            ("2000-01-01T00:00:00Z", created["id"]),
        )

    assert store.verify_mcp_service_token(created["raw_token"]) is None
