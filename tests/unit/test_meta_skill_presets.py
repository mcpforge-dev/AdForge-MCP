from __future__ import annotations

from ad_mcp.core.meta_skill_presets import (
    build_budget_skill_summary,
    build_clickhouse_contract,
    build_disable_candidates_skill,
    build_skill_catalog,
)
from ad_mcp.settings import Settings


def test_build_clickhouse_contract_uses_settings_values() -> None:
    settings = Settings(
        clickhouse_host="clickhouse.internal",
        clickhouse_port=9000,
        clickhouse_database="ads_ai",
        clickhouse_user="analytics",
        clickhouse_password="secret",
    )

    contract = build_clickhouse_contract(settings)

    assert contract["database"]["engine"] == "ClickHouse"
    assert contract["database"]["host"] == "clickhouse.internal"
    assert contract["database"]["port"] == 9000
    assert contract["database"]["database"] == "ads_ai"
    assert contract["database"]["user"] == "analytics"
    assert len(contract["tables"]) >= 4


def test_build_skill_catalog_returns_mcp_native_presets() -> None:
    skills = build_skill_catalog("act_123", "2026-06-02")

    assert [skill["id"] for skill in skills] == [
        "collect_report",
        "budget_summary",
        "disable_candidates",
        "scale_candidates",
    ]
    assert all("MCP server ads" in skill["prompt"] for skill in skills)
    assert all(skill["web_path"].startswith("/api/meta/skills/") for skill in skills)


def test_build_skill_catalog_uses_requested_provider() -> None:
    skills = build_skill_catalog("2497974272", "2026-07-01", provider="google_ads")

    assert all("provider google_ads" in skill["prompt"] for skill in skills)
    assert all("provider meta_ads" not in skill["prompt"] for skill in skills)


def test_build_budget_skill_summary_builds_human_readable_summary() -> None:
    payload = build_budget_skill_summary(
        "act_123",
        "2026-06-02",
        {
            "periods": [
                {"period": "today", "spend": 10},
                {"period": "last_7_days", "spend": 77.5},
                {"period": "last_30_days", "spend": 301.2},
            ]
        },
        {"billing": {"balance_due": 12.4}},
    )

    assert payload["title"] == "Сколько слили бюджета"
    assert "сегодня 10.00 USD" in payload["summary"]
    assert "за 7 дней 77.50 USD" in payload["summary"]
    assert "Задолженность" in payload["summary"]


def test_build_budget_skill_summary_does_not_turn_missing_spend_into_zero() -> None:
    payload = build_budget_skill_summary(
        "2497974272",
        "2026-07-01",
        {"periods": []},
        {"billing": {}},
    )

    assert "0.00 USD" not in payload["summary"]
    assert "данные не предоставлены" in payload["summary"]


def test_build_disable_candidates_skill_merges_no_result_and_issue_sources() -> None:
    payload = build_disable_candidates_skill(
        "act_123",
        "2026-05-27",
        "2026-06-02",
        {
            "issues": [
                {
                    "id": "ad_2",
                    "name": "Problem ad",
                    "status": "DISAPPROVED",
                    "review_feedback": "Policy issue",
                }
            ]
        },
        {
            "rows": [
                {
                    "entity_id": "ad_1",
                    "entity_name": "No result ad",
                    "spend": 25,
                    "conversions": 0,
                    "ctr": 0.8,
                }
            ]
        },
        min_spend=20,
    )

    assert payload["title"] == "Что отключать"
    assert len(payload["candidates"]) == 2
    assert payload["candidates"][0]["source"] == "no_result_spend"
    assert payload["candidates"][1]["source"] == "delivery_issues"
