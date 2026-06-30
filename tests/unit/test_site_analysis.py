from __future__ import annotations

import pytest

from ad_mcp.tools.site_analysis import SiteAnalysisError, analyze_html, analyze_site_improvements


def test_analyze_html_returns_advanced_cro_report() -> None:
    html = """
    <!doctype html>
    <html>
      <head><title>Clinic</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body>
        <h1>Медицинский центр</h1>
        <p>Записаться на консультацию можно сегодня. Мы помогаем пациентам.</p>
        <button>Записаться</button>
        <img src="/doctor.jpg">
      </body>
    </html>
    """

    result = analyze_html(html, url="https://example.com")

    assert result["status"] == "ok"
    assert result["checks"]["h1_count"] == 1
    assert result["checks"]["viewport_present"] is True
    assert result["checks"]["images_without_alt"] == 1
    assert result["overall_score"] > 0
    assert len(result["scores"]) == 9
    assert result["top_issues"]
    assert result["quick_wins"]
    assert result["rewritten_copy"]["h1_variants"]
    assert result["recommended_structure"]
    assert result["implementation_plan"]
    assert result["questions"]
    assert result["top_issues"][0]["evidence"]
    assert len(result["priority_recommendations"]) <= 6
    assert any(item["area"] == "Усилить главный заголовок" for item in result["priority_recommendations"])


def test_analyze_html_records_assumptions_when_brief_is_empty() -> None:
    result = analyze_html("<html><head><title>Demo</title></head><body><h1>Demo</h1></body></html>", url="https://example.com")

    assert result["assumptions"]
    assert result["mode"] == "quick"


def test_analyze_html_uses_full_mode_for_top_10() -> None:
    result = analyze_html("<html><body><h1>Услуги</h1></body></html>", url="https://example.com", mode="full")

    assert result["mode"] == "full"
    titles = [item["title"] for item in result["top_issues"]]
    assert len(titles) == len(set(titles))
    assert len(result["top_issues"]) >= 6


@pytest.mark.parametrize("url", ["http://127.0.0.1", "http://localhost", "http://10.0.0.1"])
def test_analyze_site_rejects_private_targets(url: str) -> None:
    with pytest.raises(SiteAnalysisError):
        analyze_site_improvements(url)
