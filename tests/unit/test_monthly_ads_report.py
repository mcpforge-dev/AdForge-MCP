from __future__ import annotations

import io

import pytest

from ad_mcp.core.models import ReportResponse
from ad_mcp.reporting.monthly_ads import collect_monthly_ads_report
from ad_mcp.web.monthly_ads_report import build_monthly_ads_report_docx
from ad_mcp.web.monthly_ads_report_pdf import build_monthly_ads_report_pdf


class FakeProvider:
    def get_report(self, request):
        if request.date_range.start_date == "2026-06-01":
            rows = [
                {"campaign_id": "1", "campaign_name": "Brand", "spend": 60, "impressions": 1000, "clicks": 100, "conversions": 6, "interactions": 120},
                {"campaign_id": "2", "campaign_name": "Search", "spend": 40, "impressions": 800, "clicks": 40, "conversions": 2, "interactions": 55},
            ]
        else:
            rows = [
                {"campaign_id": "1", "campaign_name": "Brand", "spend": 50, "impressions": 900, "clicks": 80, "conversions": 4, "interactions": 100},
            ]
        return ReportResponse(
            provider=request.provider,
            entity_level=request.entity_level,
            date_range=request.date_range,
            rows=rows,
            normalized_metrics=request.fields,
            native_metrics=[],
            unsupported_requested_fields=[],
            source_api="fake_ads_api",
            preview=False,
        )


def test_collect_monthly_report_is_traceable_and_computes_comparison() -> None:
    dataset = collect_monthly_ads_report(
        FakeProvider(),
        provider="meta_ads",
        account_id="act_123",
        start_date="2026-06-01",
        end_date="2026-06-07",
        account_name="Demo account",
        currency="USD",
    )

    assert dataset["mode"] == "draft_with_gaps"
    assert dataset["source"]["real_data"] is True
    assert dataset["metrics"]["spend"]["value"] == 100
    assert dataset["metrics"]["ctr"]["value"] == pytest.approx(7.777778, rel=1e-5)
    assert dataset["comparison"]["conversions"]["delta"] == 4
    assert dataset["top_campaign"]["entity_name"] == "Brand"
    assert dataset["top_campaign"]["spend_share_percent"] == pytest.approx(60)
    assert len(dataset["questions"]) == 3
    assert all(assertion["evidence_ids"] for assertion in dataset["assertions"])
    assert not any(assertion["type"] == "causal" for assertion in dataset["assertions"])


def test_empty_source_marks_metrics_unknown_instead_of_zero() -> None:
    class EmptyProvider:
        def get_report(self, request):
            return ReportResponse(
                provider=request.provider,
                entity_level=request.entity_level,
                date_range=request.date_range,
                rows=[],
                normalized_metrics=[],
                native_metrics=[],
                unsupported_requested_fields=[],
                source_api="fake_ads_api",
                preview=False,
            )

    dataset = collect_monthly_ads_report(
        EmptyProvider(),
        provider="google_ads",
        account_id="123",
        start_date="2026-06-01",
        end_date="2026-06-01",
        include_previous=False,
    )

    assert dataset["source"]["data_status"] == "empty"
    assert dataset["metrics"]["spend"]["value"] is None
    spend_fact = next(fact for fact in dataset["facts"] if fact["fact_id"] == "current_spend")
    assert spend_fact["provenance"]["status"] == "UNKNOWN"


def test_monthly_report_docx_has_client_sections() -> None:
    dataset = collect_monthly_ads_report(
        FakeProvider(),
        provider="meta_ads",
        account_id="act_123",
        start_date="2026-06-01",
        end_date="2026-06-07",
        account_name="Demo account",
        currency="USD",
        include_previous=False,
    )
    report = build_monthly_ads_report_docx(dataset)
    assert report.startswith(b"PK")
    docx = pytest.importorskip("docx")
    document = docx.Document(io.BytesIO(report))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "Месячный отчёт" in text
    assert "Общие итоги" in text
    assert "Вопросы клиенту" in text
    assert "Реестр источников" in text
