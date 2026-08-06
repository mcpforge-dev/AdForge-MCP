import pytest

from ad_mcp.server import create_server
from ad_mcp.settings import Settings


@pytest.mark.asyncio
async def test_meta_app_review_tools_are_registered_for_mcp_clients(tmp_path) -> None:
    mcp = create_server(
        Settings(
            project_root=tmp_path,
            connection_store_path="tokens/connections.json",
            connections_fallback_to_local=False,
        )
    )
    names = {tool.name for tool in await mcp.list_tools()}

    assert {
        "get_meta_oauth_permissions",
        "list_meta_businesses",
        "get_meta_business",
        "list_business_ad_accounts",
        "list_business_pages",
        "list_meta_pages",
        "get_meta_page",
        "list_page_posts",
        "get_page_post",
        "get_page_post_engagement",
        "get_page_instagram_account",
        "commit_meta_app_review_preview",
        "preview_meta_create_campaign",
        "preview_meta_create_adset",
        "preview_meta_create_creative",
        "preview_meta_create_ad",
        "preview_meta_update_campaign",
        "preview_meta_update_adset",
        "preview_meta_update_ad",
        "commit_meta_confirmed_write",
    } <= names
