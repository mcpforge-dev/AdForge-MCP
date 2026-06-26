import json

import pytest
from mcp.types import TextContent

from ad_mcp.core.connection_store import HostedConnectionStore
from ad_mcp.runtime_context import workspace_scope
from ad_mcp.server import create_server
from ad_mcp.settings import Settings


def _json_tool_payload(result: list[TextContent]) -> dict:
    assert result
    assert isinstance(result[0], TextContent)
    return json.loads(result[0].text)


def _json_tool_items(result: list[TextContent]) -> list[dict]:
    if isinstance(result, tuple):
        result = result[0]
    return [json.loads(item.text) for item in result if isinstance(item, TextContent)]


@pytest.mark.asyncio
async def test_beta_diagnostics_tool_is_registered_and_safe() -> None:
    mcp = create_server()
    tools = await mcp.list_tools()
    tool_names = {tool.name for tool in tools}

    assert "get_beta_diagnostics" in tool_names
    assert "analyze_site_improvements" in tool_names

    result = await mcp.call_tool("get_beta_diagnostics", {})
    payload = _json_tool_payload(result)

    assert payload["status"] == "ok"
    assert payload["smoke_checks"]["diagnostics_available"] is True
    assert payload["security"]["execution_mode"] == "simulated_no_write"
    assert payload["security"]["preview_only"] is True
    assert payload["smoke_checks"]["live_writes_enabled"] is False

    meta_account = payload["providers"]["meta_ads"]["accounts"][0]
    assert set(meta_account) == {"name", "account_id", "status"}


@pytest.mark.asyncio
async def test_beta_diagnostics_reads_accounts_from_hosted_connection_store(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    HostedConnectionStore(settings.connection_store_file).save_provider_config(
        "meta_ads",
        {
            "provider": "meta_ads",
            "accounts": [{"name": "Hosted Meta", "account_id": "hosted_123", "status": "connected", "access_token": "secret"}],
        },
    )
    mcp = create_server(settings)

    result = await mcp.call_tool("get_beta_diagnostics", {})
    payload = _json_tool_payload(result)

    assert payload["config"]["connection_store"]["provider_sources"]["meta_ads"] == "hosted_connection_store"
    assert payload["providers"]["meta_ads"]["accounts"] == [{"name": "Hosted Meta", "account_id": "hosted_123", "status": "connected"}]


@pytest.mark.asyncio
async def test_mcp_discovery_refreshes_hosted_connections_without_restart(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = HostedConnectionStore(settings.connection_store_file)
    mcp = create_server(settings)

    empty_accounts = await mcp.call_tool("list_accounts", {"provider": "meta_ads"})
    assert empty_accounts[0] == []

    store.save_provider_config(
        "meta_ads",
        {
            "provider": "meta_ads",
            "accounts": [{"name": "Fresh Meta", "account_id": "act_fresh", "status": "connected", "access_token": "secret"}],
        },
    )

    accounts = _json_tool_items(await mcp.call_tool("list_accounts", {"provider": "meta_ads"}))
    diagnostics = _json_tool_payload(await mcp.call_tool("get_beta_diagnostics", {}))

    assert accounts == [{"provider": "meta_ads", "name": "Fresh Meta", "account_id": "act_fresh", "status": "connected"}]
    assert diagnostics["providers"]["meta_ads"]["account_count"] == 1
    assert diagnostics["config"]["connection_store"]["provider_sources"]["meta_ads"] == "hosted_connection_store"


@pytest.mark.asyncio
async def test_mcp_tools_are_scoped_to_current_workspace(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = HostedConnectionStore(settings.connection_store_file)
    store.save_provider_config(
        "meta_ads",
        {"provider": "meta_ads", "accounts": [{"name": "User A Meta", "account_id": "act_a", "status": "connected"}]},
        workspace_id="workspace-a",
        user_id="user-a",
    )
    store.save_provider_config(
        "meta_ads",
        {"provider": "meta_ads", "accounts": [{"name": "User B Meta", "account_id": "act_b", "status": "connected"}]},
        workspace_id="workspace-b",
        user_id="user-b",
    )
    mcp = create_server(settings)

    with workspace_scope("workspace-a"):
        accounts_a = _json_tool_items(await mcp.call_tool("list_accounts", {"provider": "meta_ads"}))
        platforms_a = _json_tool_payload(await mcp.call_tool("list_connected_platforms", {}))
    with workspace_scope("workspace-b"):
        accounts_b = _json_tool_items(await mcp.call_tool("list_accounts", {"provider": "meta_ads"}))
        platforms_b = _json_tool_payload(await mcp.call_tool("list_connected_platforms", {}))
    with workspace_scope("workspace-empty"):
        accounts_empty = _json_tool_items(await mcp.call_tool("list_accounts", {"provider": "meta_ads"}))

    assert accounts_a == [{"provider": "meta_ads", "name": "User A Meta", "account_id": "act_a", "status": "connected"}]
    assert next(item for item in platforms_a["platforms"] if item["platform"] == "meta_ads")["account_count"] == 1
    assert accounts_b == [{"provider": "meta_ads", "name": "User B Meta", "account_id": "act_b", "status": "connected"}]
    assert next(item for item in platforms_b["platforms"] if item["platform"] == "meta_ads")["account_count"] == 1
    assert accounts_empty == []


@pytest.mark.asyncio
async def test_unscoped_mcp_tools_read_single_workspace_google_accounts(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    store = HostedConnectionStore(settings.connection_store_file)
    store.save_provider_config(
        "google_ads",
        {
            "provider": "google_ads",
            "accounts": [
                {
                    "name": "Google Client",
                    "customer_id": "1234567890",
                    "status": "connected",
                    "refresh_token": "refresh-token",
                    "developer_token": "developer-token",
                }
            ],
        },
        workspace_id="workspace-a",
        user_id="user-a",
    )
    mcp = create_server(settings)

    accounts = _json_tool_payload(await mcp.call_tool("list_ad_accounts", {"platform": "google_ads"}))
    platforms = _json_tool_payload(await mcp.call_tool("list_connected_platforms", {}))
    google = next(item for item in platforms["platforms"] if item["platform"] == "google_ads")

    assert accounts["account_count"] == 1
    assert accounts["accounts"][0]["account_id"] == "1234567890"
    assert accounts["accounts"][0]["credentials_present"] is True
    assert accounts["accounts"][0]["source"] == "hosted_connection_store_single_workspace"
    assert google["status"] == "connected"
    assert google["account_count"] == 1


@pytest.mark.asyncio
async def test_beta_read_tools_are_registered_and_hide_connection_secrets(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    HostedConnectionStore(settings.connection_store_file).save_provider_config(
        "meta_ads",
        {
            "provider": "meta_ads",
            "accounts": [
                {
                    "name": "Hosted Meta",
                    "account_id": "act_123",
                    "status": "connected",
                    "currency": "USD",
                    "access_token": "unit-test-token",
                    "app_secret": "unit-test-app-value",
                }
            ],
        },
    )
    mcp = create_server(settings)
    tools = await mcp.list_tools()
    tool_names = {tool.name for tool in tools}

    assert {
        "list_connected_platforms",
        "list_ad_accounts",
        "get_account_status",
        "run_connection_diagnostics",
        "run_diagnostics",
        "list_campaigns",
        "get_campaign",
        "get_campaign_statuses",
        "get_basic_metrics",
        "preview_pause_campaign",
        "preview_resume_campaign",
        "preview_change_campaign_budget",
        "preview_change_campaign_name",
        "preview_pause_adset_or_group",
        "preview_resume_adset_or_group",
        "preview_change_adset_or_group_budget",
        "preview_pause_ad",
        "preview_resume_ad",
    }.issubset(tool_names)

    accounts = _json_tool_payload(await mcp.call_tool("list_ad_accounts", {"platform": "meta_ads"}))
    assert accounts["account_count"] == 1
    account = accounts["accounts"][0]
    assert account["platform"] == "meta_ads"
    assert account["connection_status"] == "active"
    assert account["credentials_present"] is True
    assert "access_token" not in account
    assert "app_secret" not in account

    status = _json_tool_payload(await mcp.call_tool("get_account_status", {"platform": "meta_ads", "account_id": "123"}))
    assert status["status"] == "active"
    assert status["credentials_present"] is True


@pytest.mark.asyncio
async def test_beta_read_tools_return_not_available_without_fake_data(tmp_path) -> None:
    settings = Settings(
        project_root=tmp_path,
        connection_store_path="tokens/connections.json",
        connections_fallback_to_local=False,
    )
    HostedConnectionStore(settings.connection_store_file).save_provider_config(
        "tiktok_ads",
        {
            "provider": "tiktok_ads",
            "accounts": [
                {
                    "name": "TikTok Demo",
                    "account_id": "7444458786967928833",
                    "advertiser_id": "7444458786967928833",
                    "status": "connected",
                    "access_token": "secret-token",
                }
            ],
        },
    )
    mcp = create_server(settings)

    campaigns = _json_tool_payload(
        await mcp.call_tool(
            "list_campaigns",
            {"platform": "tiktok_ads", "account_id": "7444458786967928833"},
        )
    )
    assert campaigns["status"] == "not_available"
    assert campaigns["real_data"] is False

    metrics = _json_tool_payload(
        await mcp.call_tool(
            "get_basic_metrics",
            {
                "platform": "tiktok_ads",
                "account_id": "7444458786967928833",
                "date_from": "2026-06-01",
                "date_to": "2026-06-07",
            },
        )
    )
    assert metrics["status"] == "not_available"
    assert metrics["real_data"] is False
    assert "rows" not in metrics
