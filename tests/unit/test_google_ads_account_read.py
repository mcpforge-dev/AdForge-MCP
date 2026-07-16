from types import SimpleNamespace

from ad_mcp.providers.google_ads import account_read
from ad_mcp.providers.google_ads.auth import GoogleAdsCredentials
from ad_mcp.providers.google_ads.client import GoogleAdsProvider


def _credentials() -> GoogleAdsCredentials:
    return GoogleAdsCredentials(
        account_id="2222222222",
        customer_id="2222222222",
        developer_token="developer-token",
        oauth_client_id="client-id",
        oauth_client_secret="client-secret",
        refresh_token="refresh-token",
        login_customer_id="1111111111",
    )


def test_campaign_query_uses_v23_date_time_fields(monkeypatch) -> None:
    queries: list[str] = []
    result = SimpleNamespace(
        campaign=SimpleNamespace(
            id=42,
            name="Search",
            status="ENABLED",
            advertising_channel_type="SEARCH",
            start_date_time="2026-01-02 00:00:00",
            end_date_time="2026-12-31 23:59:59",
        ),
        campaign_budget=SimpleNamespace(amount_micros=5_000_000, delivery_method="STANDARD"),
        customer=SimpleNamespace(currency_code="KZT"),
    )

    class FakeService:
        def search_stream(self, *, customer_id: str, query: str):
            assert customer_id == "2222222222"
            queries.append(query)
            return [SimpleNamespace(results=[result])]

    fake_client = SimpleNamespace(get_service=lambda _name: FakeService())
    monkeypatch.setattr(account_read, "_client", lambda _credentials: fake_client)

    payload = account_read.fetch_google_campaigns(_credentials())

    assert "campaign.start_date_time" in queries[0]
    assert "campaign.end_date_time" in queries[0]
    assert "campaign.start_date," not in queries[0]
    assert payload["rows"][0]["start_date"] == "2026-01-02"
    assert payload["rows"][0]["end_date"] == "2026-12-31"


def test_manager_account_requires_client_account() -> None:
    provider = GoogleAdsProvider(
        {
            "accounts": [
                {
                    "account_id": "1111111111",
                    "customer_id": "1111111111",
                    "google_ads_account_type": "manager",
                }
            ]
        }
    )

    payload = provider.list_account_objects("1111111111", "campaign")

    assert payload["status"] == "requires_client_account"
    assert payload["rows"] == []
    assert "list_ad_accounts" in payload["message"]
