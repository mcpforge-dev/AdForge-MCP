from __future__ import annotations

import io

import pytest

docx = pytest.importorskip("docx")

from ad_mcp.web.site_analysis_report import build_site_analysis_docx


def test_build_site_analysis_docx_contains_client_sections() -> None:
    report = build_site_analysis_docx(
        {
            "status": "ok",
            "url": "https://example.com",
            "overall_score": 72,
            "summary": "Страница понятна, но требует усиления CTA.",
            "verdict": {"summary": "Рабочая основа.", "main_risk": "Слабый CTA", "fastest_win": "Переписать кнопку"},
            "audit_overview": {
                "confidence": {"score": 85, "label": "высокая", "sources": ["HTML", "rendered DOM"], "limitations": ["Одна страница"]},
                "pillars": [
                    {
                        "title": "Техническая готовность",
                        "score": 75,
                        "checks": [{"title": "Canonical", "status": "warn", "evidence": "не найден", "action": "Добавить canonical"}],
                    }
                ],
            },
            "top_issues": [{"priority": "P1", "title": "Усилить CTA", "problem": "CTA общий", "what_to_do": "Сделать конкретным", "evidence": "Кнопка: Подробнее"}],
            "first_screen_review": {"five_second_takeaway": "Оффер понятен частично", "found": {"h1": "Demo", "ctas": ["Подробнее"]}, "friction": ["Нет доверия"], "example_hero": {"h1": "Новый H1", "primary_cta": "Получить расчёт"}},
            "one_day_plan": [{"task": "Переписать CTA", "owner": "маркетолог", "time": "30 минут", "expected_effect": "Больше заявок", "placement": "Первый экран"}],
            "implementation_plan": [{"task": "Обновить hero", "impact": "высокое", "difficulty": "средняя", "priority": "P1", "owner": "дизайнер"}],
        }
    )

    assert report.startswith(b"PK")
    document = docx.Document(io.BytesIO(report))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "AI-анализ сайта HolyMedia MCP" in text
    assert "Диагностика и доказательства" in text
    assert "Разбор первого экрана" in text
