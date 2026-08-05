from __future__ import annotations

from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.graph_read import (
    get_page_instagram_account,
    list_business_ad_accounts,
    list_meta_businesses,
    list_page_posts,
)


class _Response:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def json(self) -> dict:
        return self.payload

    def raise_for_status(self) -> None:
        return None


class _HTTP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, dict]] = []

    def get(self, url: str, params: dict | None = None, headers: dict | None = None) -> _Response:
        self.calls.append((url, params or {}, headers or {}))
        if url.endswith("/me/businesses"):
            return _Response({"data": [{"id": "business_1", "name": "HolyMedia"}]})
        if url.endswith("/business_1/owned_ad_accounts"):
            return _Response({"data": [{"id": "act_1", "name": "Owned"}]})
        if url.endswith("/business_1/client_ad_accounts"):
            return _Response({"data": [{"id": "act_2", "name": "Client"}]})
        if url.endswith("/me/accounts"):
            return _Response({"data": [{"id": "page_1", "name": "Page", "access_token": "page-token"}]})
        if url.endswith("/page_1/published_posts"):
            assert headers == {"Authorization": "Bearer page-token"}
            return _Response({"data": [{"id": "page_1_post_1", "message": "Hello"}]})
        if url.endswith("/page_1"):
            assert headers == {"Authorization": "Bearer page-token"}
            return _Response(
                {
                    "id": "page_1",
                    "name": "Page",
                    "instagram_business_account": {"id": "ig_1", "username": "brand"},
                }
            )
        raise AssertionError(f"Unexpected Meta Graph call: {url}")


def _credentials() -> MetaAccountCredentials:
    return MetaAccountCredentials(
        account_id="1",
        app_id="app",
        app_secret="secret",
        access_token="user-token",
    )


def test_business_reads_are_live_and_paginated_across_owned_and_client_assets() -> None:
    http = _HTTP()
    businesses = list_meta_businesses(_credentials(), http_client=http)
    accounts = list_business_ad_accounts(_credentials(), "business_1", http_client=http)

    assert businesses["businesses"] == [{"id": "business_1", "name": "HolyMedia"}]
    assert businesses["source_api"] == "meta_graph_api"
    assert businesses["real_data"] is True
    assert businesses["data_status"] == "real"
    assert businesses["fetched_at"]
    assert {row["business_relationship"] for row in accounts["ad_accounts"]} == {
        "owned_ad_accounts",
        "client_ad_accounts",
    }


def test_page_posts_use_page_access_token_and_never_return_it() -> None:
    payload = list_page_posts(_credentials(), "page_1", http_client=_HTTP())

    assert payload["posts"][0]["id"] == "page_1_post_1"
    assert "page-token" not in str(payload)
    assert payload["real_data"] is True


def test_instagram_is_resolved_through_connected_facebook_page() -> None:
    payload = get_page_instagram_account(_credentials(), "page_1", http_client=_HTTP())

    assert payload["linked"] is True
    assert payload["instagram_account"] == {"id": "ig_1", "username": "brand"}
    assert payload["page"] == {"id": "page_1", "name": "Page"}
