from __future__ import annotations

import pytest

from ad_mcp.web.monthly_ads_report_pdf import build_monthly_ads_report_pdf


def test_presentation_pdf_is_generated_with_expected_page_count() -> None:
    pytest.importorskip("reportlab")
    dataset = {
        "title": "Demo report",
        "provider": "meta_ads",
        "account": {"account_id": "act_123", "name": "Demo account", "currency": "USD"},
        "period": {"start": "2026-06-01", "end": "2026-06-07", "timezone": "UTC"},
        "previous_period": {"start": "2026-05-25", "end": "2026-05-31"},
        "source": {"source_api": "fake_ads_api", "real_data": True, "data_status": "ok", "fetched_at": "2026-06-08T10:00:00Z"},
        "metrics": {
            "spend": {"value": 100},
            "impressions": {"value": 1800},
            "clicks": {"value": 140},
            "conversions": {"value": 8},
            "ctr": {"value": 7.77},
            "cpc": {"value": 0.71},
            "cpa": {"value": 12.5},
        },
        "comparison": {"spend": {"current": 100, "previous": 90, "delta_percent": 11.1}},
        "campaigns": [{"entity_name": "Brand", "spend": 60, "clicks": 100, "conversions": 6, "spend_share_percent": 60}],
        "top_campaign": {"entity_name": "Brand", "spend": 60, "spend_share_percent": 60},
        "assertions": [{"text": "Расход вырос относительно предыдущего периода.", "evidence_ids": ["current_spend"]}],
        "recommendations": [{"text": "Проверить кампании с наибольшей долей расходов."}],
        "limitations": [],
        "unknowns": [],
        "pending_sections": [],
    }

    report = build_monthly_ads_report_pdf(dataset)

    assert report.startswith(b"%PDF-")
    assert report.count(b"/Type /Page") >= 8
