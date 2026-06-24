from __future__ import annotations

import pytest

from ad_mcp.tools.site_analysis import SiteAnalysisError, analyze_html, analyze_site_improvements


def test_analyze_html_returns_short_priority_recommendations() -> None:
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
    assert len(result["priority_recommendations"]) <= 6
    assert any(item["area"] == "SEO" for item in result["priority_recommendations"])


@pytest.mark.parametrize("url", ["http://127.0.0.1", "http://localhost", "http://10.0.0.1"])
def test_analyze_site_rejects_private_targets(url: str) -> None:
    with pytest.raises(SiteAnalysisError):
        analyze_site_improvements(url)
