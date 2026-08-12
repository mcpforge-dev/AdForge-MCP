import pytest

from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.providers.meta_ads.graph_read import MetaGraphAPIError, MetaGraphClient


class _NeverCalledClient:
    def get(self, *args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("The HTTP client must not receive an untrusted paging URL.")


def test_meta_graph_does_not_send_bearer_token_to_untrusted_paging_url() -> None:
    credentials = MetaAccountCredentials(
        account_id="123",
        app_id="app",
        app_secret="secret",
        access_token="token",
    )
    graph = MetaGraphClient(credentials, http_client=_NeverCalledClient())

    with pytest.raises(MetaGraphAPIError, match="not trusted"):
        graph.get("https://attacker.example/collect?next=1")


def test_meta_graph_accepts_graph_facebook_paging_url() -> None:
    class _Client:
        def get(self, url, **kwargs):  # noqa: ANN001, ANN003
            assert url == "https://graph.facebook.com/v20.0/me/accounts"
            return type("Response", (), {"json": lambda self: {"data": []}, "raise_for_status": lambda self: None})()

    credentials = MetaAccountCredentials(
        account_id="123",
        app_id="app",
        app_secret="secret",
        access_token="token",
    )
    payload = MetaGraphClient(credentials, http_client=_Client()).get("https://graph.facebook.com/v20.0/me/accounts")

    assert payload == {"data": []}
