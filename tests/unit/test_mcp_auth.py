import pytest

from ad_mcp.mcp_auth import StaticBearerTokenVerifier
from ad_mcp.runtime_context import current_workspace_id, set_current_workspace_id
from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore


@pytest.mark.asyncio
async def test_personal_mcp_token_sets_workspace_context_and_beta_token_clears_it(tmp_path) -> None:
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
    assert beta_access is not None
    assert beta_access.client_id == "adforge-beta-client"
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
