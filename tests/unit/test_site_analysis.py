from __future__ import annotations

import pytest

from ad_mcp.tools.site_analysis import SiteAnalysisError, _extract_audit_facts, analyze_html, analyze_site_improvements


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
    assert result["ready_hero"]["h1"]
    assert result["one_day_plan"]
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


def test_hotel_analysis_uses_booking_context_and_honest_score() -> None:
    html = """
    <!doctype html>
    <html>
      <head>
        <title>Kazzhol Hotel Almaty</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body>
        <h1>Отель Kazzhol в Алматы</h1>
        <h2>Номера</h2>
        <p>Гостиница предлагает номера standard и suite, ресторан, завтрак и проживание в центре Алматы.</p>
        <h2>Конференции</h2>
        <p>Есть конференц-залы для мероприятий и деловых поездок.</p>
        <button>Подробнее</button>
        <img src="/room.jpg">
      </body>
    </html>
    """

    result = analyze_html(
        html,
        url="https://kazzhol.example/ru/almaty/main/",
        site_type="отель",
        goal="бронирования",
        mode="full",
        region="Алматы",
    )

    assert result["status"] == "ok"
    assert result["checks"]["detected_vertical"] == "hotel"
    assert result["overall_score"] < 90
    ctas = result["rewritten_copy"]["cta_variants"]
    assert "Забронировать номер" in ctas
    assert "Проверить свободные номера" in ctas
    assert all("Записаться" not in item for item in ctas)
    assert result["ready_hero"]["primary_button"] == "Проверить свободные номера"
    assert result["one_day_plan"][0]["task"]
    titles = [item["title"] for item in result["top_issues"][:5]]
    assert any("бронировать на сайте выгоднее" in title for title in titles)
    assert any("CTA бронирования" in title for title in titles)
    assert not any("alt" in title.lower() for title in titles[:3])


def test_analyze_html_includes_evidence_based_audit_facts() -> None:
    html = """
    <!doctype html>
    <html>
      <head>
        <title>Hotel booking</title>
        <meta name="description" content="Direct hotel booking">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script type="application/ld+json">{"@type":"Hotel","name":"Demo Hotel"}</script>
      </head>
      <body>
        <h1>Hotel in Almaty</h1>
        <h2>Rooms and direct booking</h2>
        <p>Book direct, choose rooms, check dates, breakfast, restaurant and conference hall.</p>
        <a href="tel:+77001234567">Call hotel</a>
        <button>Book now</button>
        <form><input name="date"></form>
        <img src="/room.jpg">
      </body>
    </html>
    """
    audit_facts = {
        "engine": {"rendered_dom_used": True, "render_reason": "", "static_html_used": True},
        "screenshot": {
            "captured": True,
            "mime": "image/png",
            "bytes": 1200,
            "sha256": "abc",
            "viewport": {"width": 1365, "height": 768},
            "hero_crop": {"x": 0, "y": 0, "width": 1365, "height": 476},
            "visual_analysis": {"available": True, "theme_guess": "light", "average_luma": 230},
        },
        "first_screen_blocks": [
            {"tag": "h1", "text": "Hotel in Almaty"},
            {"tag": "button", "text": "Book now"},
        ],
        "first_screen_text": "Hotel in Almaty Book now",
        "cta_texts": ["Book now"],
        "forms": {"count": 1, "inputs": 1},
        "links": {"count": 1, "internal_count": 1, "external_count": 0, "samples": []},
        "images": {"count": 1, "without_alt": 1, "missing_alt_samples": ["/room.jpg"]},
        "structured_data": {"present": True, "count": 1, "types": ["Hotel"]},
        "accessibility": {"images_without_alt": 1},
        "pagespeed": {"enabled": False, "reason": "disabled"},
        "extraction_method": "html_parser",
    }

    result = analyze_html(html, url="https://hotel.example", audit_facts=audit_facts, mode="full")

    assert result["checks"]["detected_vertical"] == "hotel"
    assert result["checks"]["audit_engine"]["rendered_dom_used"] is True
    assert result["checks"]["audit_engine"]["screenshot_captured"] is True
    assert result["checks"]["niche_scores"]["hotel"] >= 2
    evidence = result["evidence"]["audit_engine"]
    assert evidence["first_screen_blocks"][0]["text"] == "Hotel in Almaty"
    assert evidence["structured_data"]["types"] == ["Hotel"]
    assert evidence["images"]["without_alt"] == 1
    first_screen = result["first_screen_review"]
    assert first_screen["title"] == "Разбор первого экрана"
    assert first_screen["screenshot"]["captured"] is True
    assert first_screen["example_hero"]["label"] == "Пример первого экрана, не финальный дизайн"
    assert "Book now" in first_screen["five_second_takeaway"]


def test_extract_audit_facts_collects_page_evidence_without_playwright() -> None:
    html = """
    <html>
      <head>
        <title>Demo landing</title>
        <meta name="description" content="Helpful page">
        <script type="application/ld+json">{"@type":"WebPage"}</script>
      </head>
      <body>
        <h1>Demo service</h1>
        <h2>How it works</h2>
        <a href="/contact">Contact us</a>
        <button>Get consultation</button>
        <form><input name="phone"></form>
        <img src="/hero.jpg">
      </body>
    </html>
    """

    facts = _extract_audit_facts(html, "https://example.com")

    assert facts["title"] == "Demo landing"
    assert facts["description"] == "Helpful page"
    assert facts["cta_texts"] == ["Get consultation", "Contact us"]
    assert facts["forms"]["count"] == 1
    assert facts["links"]["count"] == 1
    assert facts["images"]["without_alt"] == 1
    assert facts["structured_data"]["present"] is True
    assert facts["first_screen_blocks"]


def test_niche_detection_supports_non_hotel_verticals() -> None:
    html = """
    <html>
      <body>
        <h1>Medical clinic</h1>
        <p>Clinic doctors, patients, diagnostics, treatment and appointment booking.</p>
        <button>Book appointment</button>
      </body>
    </html>
    """

    result = analyze_html(html, url="https://clinic.example")

    assert result["checks"]["detected_vertical"] == "clinic"
    assert result["checks"]["niche_scores"]["clinic"] >= 2


def test_site_audit_dedupes_headings_and_filters_cta_noise() -> None:
    html = """
    <html>
      <body>
        <h1>Hotel Almaty</h1>
        <h2>Conference halls</h2>
        <h2>Conference halls</h2>
        <a href="mailto:booking@example.com">booking@example.com</a>
        <a href="/rooms">Rooms</a>
        <a href="/room/standard">Standard double room with breakfast and a very long card description that should not be treated as CTA</a>
        <button>Submit</button>
        <img src="/room.jpg">
      </body>
    </html>
    """

    result = analyze_html(
        html,
        url="https://hotel.example",
        site_type="hotel",
        goal="booking",
        audit_facts={
            "cta_texts": [
                "booking@example.com",
                "https://www.facebook.com/HotelKazzolAlmaty",
                "Rooms",
                "Standard double room with breakfast and a very long card description that should not be treated as CTA",
                "Submit",
            ],
            "cta_groups": {
                "booking_cta": [],
                "navigation_link": ["Rooms"],
                "form_submit": ["Submit"],
            },
            "first_screen_blocks": [{"tag": "h2", "text": "Conference halls"}, {"tag": "h2", "text": "Conference halls"}],
        },
    )

    assert result["evidence"]["h2"] == ["Conference halls"]
    groups = result["evidence"]["audit_engine"]["cta_groups"]
    assert "Rooms" in groups["navigation_link"]
    assert groups["booking_cta"] == []
    assert "booking@example.com" not in result["evidence"]["audit_engine"]["cta_texts"]
    assert not any("facebook" in item.lower() for item in result["evidence"]["audit_engine"]["cta_texts"])
    assert all(len(item) <= 70 for item in result["evidence"]["audit_engine"]["cta_texts"])
    assert result["technical_notes"]
    assert not any("alt" in item["title"].lower() for item in result["top_issues"])


@pytest.mark.parametrize("url", ["http://127.0.0.1", "http://localhost", "http://10.0.0.1"])
def test_analyze_site_rejects_private_targets(url: str) -> None:
    with pytest.raises(SiteAnalysisError):
        analyze_site_improvements(url)
