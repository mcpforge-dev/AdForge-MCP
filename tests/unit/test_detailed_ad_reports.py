from datetime import date, timedelta

from ad_mcp.providers.google_ads.detailed_reports import build_google_detailed_query
from ad_mcp.providers.meta_ads import analysis
from ad_mcp.providers.meta_ads.auth import MetaAccountCredentials
from ad_mcp.tools.ad_detailed_reports import _add_action_summary


def test_google_search_terms_query_has_entity_context_and_metrics() -> None:
    query, _ = build_google_detailed_query(
        "search_terms", "2026-07-01", "2026-07-07", campaign_id="123-456", limit=50
    )

    assert "FROM search_term_view" in query
    assert "search_term_view.search_term" in query
    assert "campaign.id = 123456" in query
    assert "metrics.cost_micros" in query
    assert query.endswith("LIMIT 50")


def test_google_change_history_is_limited_to_thirty_days() -> None:
    end = date(2026, 7, 22)
    query, _ = build_google_detailed_query("change_history", "2026-01-01", end.isoformat())

    assert (end - timedelta(days=29)).isoformat() in query
    assert "change_event.change_date_time" in query
    assert "LIMIT 500" in query


def test_meta_action_summary_keeps_raw_actions_and_derives_client_metrics() -> None:
    payload = {
        "rows": [{
            "actions": [
                {"action_type": "onsite_conversion.messaging_conversation_started_7d", "value": "3"},
                {"action_type": "post_engagement", "value": "12"},
                {"action_type": "comment", "value": "2"},
            ]
        }]
    }

    result = _add_action_summary(payload, ["post_engagement"])["rows"][0]

    assert result["messaging_conversations_started"] == 3
    assert result["post_engagement"] == 14
    assert result["action_breakdown"]["post_engagement"] == 12
    assert result["results"] == 12


def test_meta_connected_assets_returns_partial_data_and_redacts_secrets(monkeypatch) -> None:
    credentials = MetaAccountCredentials(
        account_id="123", app_id="app", app_secret="very-secret", access_token="access-token"
    )

    def fake_fetch(_credentials, object_type, limit):
        assert limit == 20
        return {"rows": [{"id": object_type}], "row_count": 1}

    monkeypatch.setattr(analysis, "fetch_meta_objects", fake_fetch)
    monkeypatch.setattr(analysis, "list_meta_pages", lambda *_args, **_kwargs: {"pages": [{"id": "page"}]})

    def fake_instagram(*_args, **_kwargs):
        raise RuntimeError("unsupported access-token very-secret")

    monkeypatch.setattr(analysis, "get_page_instagram_account", fake_instagram)

    payload = analysis.fetch_meta_connected_assets(credentials)

    assert payload["partial"] is True
    assert payload["assets"]["pages"] == [{"id": "page"}]
    assert payload["assets"]["instagram_accounts"] == []
    assert "access-token" not in payload["warnings"][0]["message"]
    assert "very-secret" not in payload["warnings"][0]["message"]
