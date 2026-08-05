"""Run safe Meta App Review checks against the configured staging MCP server."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from mcp.types import TextContent

from ad_mcp.server import create_server
from ad_mcp.settings import Settings

REQUIRED_TOOLS = {
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
}


def payload(result: Any) -> Any:
    if isinstance(result, list):
        for item in result:
            if isinstance(item, TextContent):
                try:
                    return json.loads(item.text)
                except json.JSONDecodeError:
                    return item.text
    return result


def summary(data: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        key: data[key]
        for key in ("source_api", "real_data", "data_status", "fetched_at", "row_count", "linked", "partial")
        if key in data
    }
    for key in ("businesses", "ad_accounts", "pages", "posts", "permissions", "instagram_account"):
        value = data.get(key)
        if isinstance(value, list):
            allowed[key] = [{k: v for k, v in item.items() if k not in {"access_token", "page_access_token"}} for item in value]
        elif isinstance(value, dict):
            allowed[key] = {k: v for k, v in value.items() if k not in {"access_token", "page_access_token"}}
    return allowed


async def run(account_id: str, business_id: str | None, page_id: str | None, test_campaign_id: str | None, do_commit: bool) -> dict[str, Any]:
    settings = Settings()
    mcp = create_server(settings)
    names = {tool.name for tool in await mcp.list_tools()}
    missing = sorted(REQUIRED_TOOLS - names)
    if missing:
        raise RuntimeError(f"Missing Meta App Review tools: {', '.join(missing)}")

    result: dict[str, Any] = {"status": "ok", "tools_registered": sorted(REQUIRED_TOOLS)}
    permissions = payload(await mcp.call_tool("get_meta_oauth_permissions", {"account_id": account_id}))
    result["permissions"] = summary(permissions)
    businesses = payload(await mcp.call_tool("list_meta_businesses", {"account_id": account_id}))
    result["businesses"] = summary(businesses)
    business_rows = businesses.get("businesses", []) if isinstance(businesses, dict) else []
    chosen_business = business_id or (str(business_rows[0].get("id")) if business_rows else None)
    if chosen_business:
        business = payload(await mcp.call_tool("get_meta_business", {"account_id": account_id, "business_id": chosen_business}))
        result["business"] = summary(business)
        result["business_ad_accounts"] = summary(payload(await mcp.call_tool("list_business_ad_accounts", {"account_id": account_id, "business_id": chosen_business})))
        result["business_pages"] = summary(payload(await mcp.call_tool("list_business_pages", {"account_id": account_id, "business_id": chosen_business})))

    pages = payload(await mcp.call_tool("list_meta_pages", {"account_id": account_id}))
    result["pages"] = summary(pages)
    page_rows = pages.get("pages", []) if isinstance(pages, dict) else []
    chosen_page = page_id or (str(page_rows[0].get("id")) if page_rows else None)
    if chosen_page:
        result["page"] = summary(payload(await mcp.call_tool("get_meta_page", {"account_id": account_id, "page_id": chosen_page})))
        posts = payload(await mcp.call_tool("list_page_posts", {"account_id": account_id, "page_id": chosen_page, "limit": 5}))
        result["posts"] = summary(posts)
        result["instagram"] = summary(payload(await mcp.call_tool("get_page_instagram_account", {"account_id": account_id, "page_id": chosen_page})))
        post_rows = posts.get("posts", []) if isinstance(posts, dict) else []
        if post_rows:
            post_id = str(post_rows[0].get("id"))
            result["post"] = summary(payload(await mcp.call_tool("get_page_post", {"account_id": account_id, "page_id": chosen_page, "post_id": post_id})))
            result["engagement"] = summary(payload(await mcp.call_tool("get_page_post_engagement", {"account_id": account_id, "page_id": chosen_page, "post_id": post_id})))

    campaigns = payload(await mcp.call_tool("list_account_objects", {"provider": "meta_ads", "account_id": account_id, "object_type": "campaign", "limit": 100}))
    result["ads_read"] = summary(campaigns)
    if test_campaign_id:
        new_name = "HolyMedia App Review Test"
        preview = payload(await mcp.call_tool("preview_change_campaign_name", {"platform": "meta_ads", "account_id": account_id, "campaign_id": test_campaign_id, "new_name": new_name}))
        result["preview"] = summary(preview)
        blocked = payload(await mcp.call_tool("commit_meta_app_review_preview", {"preview_token": preview.get("preview_token"), "confirmation": "CONFIRM"}))
        result["commit_without_confirmation"] = {"status": blocked.get("status"), "mode": blocked.get("provider_response", {}).get("mode")}
        if do_commit:
            confirmed = payload(await mcp.call_tool("commit_meta_app_review_preview", {"preview_token": preview.get("preview_token"), "confirmation": preview.get("explicit_confirmation")}))
            result["commit"] = summary(confirmed)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--business-id")
    parser.add_argument("--page-id")
    parser.add_argument("--test-campaign-id")
    parser.add_argument("--commit", action="store_true", help="Commit only the configured staging allowlisted test campaign.")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args.account_id, args.business_id, args.page_id, args.test_campaign_id, args.commit)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
