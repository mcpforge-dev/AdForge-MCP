from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any


PAGE_WIDTH = 960
PAGE_HEIGHT = 540
PURPLE = "#42195C"
PURPLE_MID = "#7B4A96"
PURPLE_LIGHT = "#F1EAF6"
PURPLE_PALE = "#FAF7FC"
INK = "#28252C"
MUTED = "#716A78"
GREEN = "#198754"
RED = "#B54747"
AMBER = "#A66A00"
WHITE = "#FFFFFF"


def _color(value: Any) -> Any:
    try:
        from reportlab.lib.colors import HexColor
    except ImportError:  # pragma: no cover
        return value
    return HexColor(value) if isinstance(value, str) else value


def _font_candidates() -> tuple[tuple[str, str], ...]:
    configured = str(os.getenv("AD_MCP_REPORT_FONT_PATH", "")).strip()
    return (
        (configured, configured),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"),
        (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    )


def _register_fonts() -> tuple[str, str, str]:
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError as exc:  # pragma: no cover - exercised only on minimal installs
        raise RuntimeError("Генератор PDF временно недоступен: не установлен reportlab.") from exc

    for regular_path, bold_path in _font_candidates():
        if not regular_path or not Path(regular_path).is_file():
            continue
        try:
            pdfmetrics.registerFont(TTFont("HolyMediaSans", regular_path))
            bold_name = "HolyMediaSans"
            if bold_path and Path(bold_path).is_file():
                pdfmetrics.registerFont(TTFont("HolyMediaSansBold", bold_path))
                bold_name = "HolyMediaSansBold"
            return "HolyMediaSans", bold_name, "HolyMediaSans"
        except Exception:  # noqa: BLE001 - try the next installed font
            continue
    raise RuntimeError("Генератор PDF временно недоступен: не найден шрифт с поддержкой русского текста.")


def _value(dataset: dict[str, Any], name: str) -> Any:
    item = dataset.get("metrics", {}).get(name, {})
    return item.get("value") if isinstance(item, dict) else None


def _fmt(value: Any, *, currency: str = "", percent: bool = False) -> str:
    if value is None:
        return "Нет данных"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if percent:
        return f"{number:.2f}%"
    if abs(number - round(number)) < 0.000001:
        result = f"{int(round(number)):,}".replace(",", " ")
    else:
        result = f"{number:,.2f}".replace(",", " ")
    return f"{result} {currency}".strip()


def _delta_text(item: dict[str, Any]) -> str:
    value = item.get("delta_percent")
    if value is None:
        return "Нет сравнения"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "Нет сравнения"
    return f"{number:+.1f}% к предыдущему периоду"


def _draw_text(canvas: Any, text: str, x: float, y: float, *, font: str, size: float, color: str = INK) -> None:
    canvas.setFillColor(_color(color))
    canvas.setFont(font, size)
    canvas.drawString(x, y, str(text))


def _wrap(canvas: Any, text: str, font: str, size: float, max_width: float) -> list[str]:
    words = str(text or "").split()
    if not words:
        return [""]
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and canvas.stringWidth(candidate, font, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _draw_wrapped(canvas: Any, text: str, x: float, y: float, max_width: float, *, font: str, size: float, leading: float, color: str = INK, max_lines: int | None = None) -> float:
    lines = _wrap(canvas, text, font, size, max_width)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        suffix = lines[-1].rstrip(" .")
        lines[-1] = suffix + "…"
    canvas.setFillColor(_color(color))
    canvas.setFont(font, size)
    for line in lines:
        canvas.drawString(x, y, line)
        y -= leading
    return y


def _page_header(canvas: Any, title: str, page: int, *, font: str, bold: str) -> None:
    canvas.setFillColor(_color(PURPLE))
    canvas.rect(0, PAGE_HEIGHT - 72, PAGE_WIDTH, 72, fill=1, stroke=0)
    _draw_text(canvas, title, 54, PAGE_HEIGHT - 45, font=bold, size=20, color=WHITE)
    _draw_text(canvas, f"{page:02d}", PAGE_WIDTH - 64, PAGE_HEIGHT - 45, font=bold, size=14, color="#DCC7E6")


def _footer(canvas: Any, text: str, *, font: str) -> None:
    _draw_text(canvas, text, 54, 24, font=font, size=9, color=MUTED)


def _card(canvas: Any, x: float, y: float, width: float, height: float, label: str, value: str, detail: str, *, font: str, bold: str) -> None:
    canvas.setFillColor(_color(WHITE))
    canvas.setStrokeColor(_color("#E5DDEA"))
    canvas.roundRect(x, y, width, height, 8, fill=1, stroke=1)
    _draw_text(canvas, label.upper(), x + 16, y + height - 24, font=bold, size=9, color=MUTED)
    _draw_text(canvas, value, x + 16, y + height - 61, font=bold, size=23, color=PURPLE)
    _draw_wrapped(canvas, detail, x + 16, y + 18, width - 32, font=font, size=9, leading=11, color=MUTED, max_lines=2)


def _table(canvas: Any, x: float, y: float, widths: list[float], headers: list[str], rows: list[list[str]], *, font: str, bold: str, row_height: float = 27) -> None:
    total = sum(widths)
    canvas.setFillColor(_color(PURPLE))
    canvas.rect(x, y - row_height, total, row_height, fill=1, stroke=0)
    cursor = x
    for width, header in zip(widths, headers):
        _draw_text(canvas, header, cursor + 8, y - 18, font=bold, size=9, color=WHITE)
        cursor += width
    for row_index, row in enumerate(rows):
        row_y = y - row_height * (row_index + 2)
        canvas.setFillColor(_color(PURPLE_PALE if row_index % 2 == 0 else WHITE))
        canvas.rect(x, row_y, total, row_height, fill=1, stroke=0)
        cursor = x
        for width, value in zip(widths, row):
            _draw_wrapped(canvas, value, cursor + 8, row_y + 16, width - 16, font=font, size=8.5, leading=10, color=INK, max_lines=2)
            cursor += width
    canvas.setStrokeColor(_color("#E5DDEA"))
    canvas.rect(x, y - row_height * (len(rows) + 1), total, row_height * (len(rows) + 1), fill=0, stroke=1)


def _bullet_list(canvas: Any, items: list[str], x: float, y: float, width: float, *, font: str, bold: str, max_items: int = 5) -> float:
    for index, item in enumerate(items[:max_items]):
        canvas.setFillColor(_color(PURPLE_MID))
        canvas.circle(x + 6, y + 3, 5, fill=1, stroke=0)
        y = _draw_wrapped(canvas, item, x + 20, y + 8, width - 20, font=font, size=12, leading=18, color=INK, max_lines=3)
        y -= 12
    return y


def build_monthly_ads_report_pdf(dataset: dict[str, Any]) -> bytes:
    """Build a presentation-style PDF that stays evidence-based and client-readable."""
    try:
        from reportlab.lib.colors import HexColor
        from reportlab.pdfgen import canvas as pdf_canvas
    except ImportError as exc:  # pragma: no cover - exercised only on minimal installs
        raise RuntimeError("Генератор PDF временно недоступен: не установлен reportlab.") from exc

    font, bold, _ = _register_fonts()
    buffer = io.BytesIO()
    canvas = pdf_canvas.Canvas(buffer, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    canvas.setTitle(str(dataset.get("title") or "HolyMedia MCP — отчёт по рекламе"))
    canvas.setAuthor("HolyMedia MCP")

    account = dataset.get("account", {}) if isinstance(dataset.get("account"), dict) else {}
    period = dataset.get("period", {}) if isinstance(dataset.get("period"), dict) else {}
    previous = dataset.get("previous_period", {}) if isinstance(dataset.get("previous_period"), dict) else {}
    source = dataset.get("source", {}) if isinstance(dataset.get("source"), dict) else {}
    provider = str(dataset.get("provider", "ads")).replace("_", " ").title()
    account_name = str(account.get("name") or account.get("account_id") or "Рекламный кабинет")
    currency = str(account.get("currency") or "USD")
    start = str(period.get("start") or "—")
    end = str(period.get("end") or "—")
    real_data = bool(source.get("real_data"))
    data_status = "Живые данные рекламного кабинета" if real_data else "Неполный ответ источника; пропуски отмечены"

    # Cover
    canvas.setFillColor(HexColor(PURPLE))
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#6A3D82"))
    canvas.circle(810, 390, 175, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#5A2F73"))
    canvas.circle(880, 160, 125, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#875BA0"))
    canvas.circle(735, 122, 82, fill=1, stroke=0)
    _draw_text(canvas, "HOLYMEDIA MCP", 58, 466, font=bold, size=12, color="#DCC7E6")
    _draw_text(canvas, "Отчёт по рекламным", 58, 356, font=bold, size=36, color=WHITE)
    _draw_text(canvas, "кампаниям", 58, 312, font=bold, size=36, color=WHITE)
    _draw_text(canvas, f"{start} — {end}", 60, 255, font=font, size=19, color="#DCC7E6")
    _draw_text(canvas, f"{account_name} · {provider}", 60, 78, font=bold, size=13, color=WHITE)
    _draw_text(canvas, f"{currency} · {data_status}", 60, 54, font=font, size=10, color="#DCC7E6")
    canvas.showPage()

    # KPI overview
    canvas.setFillColor(HexColor(PURPLE_LIGHT))
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    _page_header(canvas, "Итоги периода", 2, font=font, bold=bold)
    _draw_text(canvas, f"{account_name} · {start} — {end}", 54, 438, font=font, size=11, color=MUTED)
    card_width = 200
    for index, (label, value, detail) in enumerate([
        ("Расход", _fmt(_value(dataset, "spend"), currency=currency), "Фактические расходы за период"),
        ("Показы", _fmt(_value(dataset, "impressions")), "Сколько раз реклама была показана"),
        ("Клики", _fmt(_value(dataset, "clicks")), "Переходы по рекламным объявлениям"),
        ("Конверсии", _fmt(_value(dataset, "conversions")), "Конверсии, которые вернул источник"),
    ]):
        _card(canvas, 54 + index * 216, 300, card_width, 112, label, value, detail, font=font, bold=bold)
    _draw_text(canvas, "Ключевые показатели", 54, 258, font=bold, size=18, color=PURPLE)
    summary_rows = [
        ["CTR", _fmt(_value(dataset, "ctr"), percent=True), "Средняя стоимость клика", _fmt(_value(dataset, "cpc"), currency=currency)],
        ["Стоимость конверсии", _fmt(_value(dataset, "cpa"), currency=currency), "Статус данных", data_status],
    ]
    _table(canvas, 54, 230, [145, 185, 190, 332], ["Показатель", "Значение", "Показатель", "Значение"], summary_rows, font=font, bold=bold)
    _footer(canvas, "HolyMedia MCP · цифры относятся только к выбранному кабинету и периоду", font=font)
    canvas.showPage()

    # Comparison
    canvas.setFillColor(HexColor(WHITE))
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    _page_header(canvas, "Динамика относительно прошлого периода", 3, font=font, bold=bold)
    _draw_text(canvas, f"Текущий период: {start} — {end}", 54, 438, font=font, size=11, color=MUTED)
    _draw_text(canvas, f"Предыдущий: {previous.get('start', '—')} — {previous.get('end', '—')}", 54, 420, font=font, size=11, color=MUTED)
    comparison = dataset.get("comparison", {}) if isinstance(dataset.get("comparison"), dict) else {}
    rows: list[list[str]] = []
    for metric, label, is_percent in (("spend", "Расход", False), ("impressions", "Показы", False), ("clicks", "Клики", False), ("conversions", "Конверсии", False), ("ctr", "CTR", True), ("cpc", "CPC", False), ("cpa", "CPA", False)):
        item = comparison.get(metric, {}) if isinstance(comparison.get(metric), dict) else {}
        rows.append([label, _fmt(item.get("current"), currency=currency, percent=is_percent), _fmt(item.get("previous"), currency=currency, percent=is_percent), _delta_text(item)])
    _table(canvas, 54, 388, [180, 190, 190, 300], ["Показатель", "Текущий", "Предыдущий", "Изменение"], rows, font=font, bold=bold, row_height=27)
    canvas.setFillColor(HexColor(PURPLE_PALE))
    canvas.roundRect(54, 52, 850, 70, 8, fill=1, stroke=0)
    _draw_text(canvas, "Как читать сравнение", 72, 95, font=bold, size=11, color=PURPLE)
    _draw_wrapped(canvas, "Изменения показывают только подтверждённую динамику. Причины, которых нет в данных рекламного кабинета, в отчёт не добавляются.", 72, 77, 810, font=font, size=11, leading=16, color=INK, max_lines=2)
    canvas.showPage()

    # Campaign table and chart
    canvas.setFillColor(HexColor(PURPLE_LIGHT))
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    _page_header(canvas, "Кампании и распределение расходов", 4, font=font, bold=bold)
    campaigns = dataset.get("campaigns", []) if isinstance(dataset.get("campaigns"), list) else []
    campaign_rows: list[list[str]] = []
    for campaign in campaigns[:7]:
        campaign_rows.append([
            str(campaign.get("entity_name") or campaign.get("entity_id") or "Без названия"),
            _fmt(campaign.get("spend"), currency=currency),
            _fmt(campaign.get("clicks")),
            _fmt(campaign.get("conversions")),
            _fmt(campaign.get("spend_share_percent"), percent=True),
        ])
    if campaign_rows:
        _table(canvas, 54, 423, [350, 130, 100, 110, 120], ["Кампания", "Расход", "Клики", "Конверсии", "Доля расходов"], campaign_rows, font=font, bold=bold, row_height=30)
    else:
        canvas.setFillColor(HexColor(WHITE))
        canvas.roundRect(54, 220, 850, 90, 8, fill=1, stroke=0)
        _draw_text(canvas, "Кампании не получены", 76, 270, font=bold, size=16, color=PURPLE)
        _draw_text(canvas, "Источник не вернул строки уровня campaign за выбранный период.", 76, 244, font=font, size=11, color=MUTED)
    top = dataset.get("top_campaign") if isinstance(dataset.get("top_campaign"), dict) else {}
    if top:
        canvas.setFillColor(HexColor(PURPLE))
        canvas.roundRect(54, 60, 850, 92, 8, fill=1, stroke=0)
        _draw_text(canvas, "Кампания с максимальным расходом", 76, 126, font=bold, size=11, color="#DCC7E6")
        _draw_wrapped(canvas, str(top.get("entity_name") or top.get("entity_id") or "Без названия"), 76, 101, 500, font=bold, size=20, leading=24, color=WHITE, max_lines=1)
        _draw_text(canvas, f"Расход: {_fmt(top.get('spend'), currency=currency)} · доля: {_fmt(top.get('spend_share_percent'), percent=True)}", 590, 101, font=font, size=11, color="#EBDDF1")
    canvas.showPage()

    # Findings
    canvas.setFillColor(HexColor(WHITE))
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    _page_header(canvas, "Подтверждённые выводы", 5, font=font, bold=bold)
    _draw_text(canvas, "Короткие выводы на основании фактов источника", 54, 438, font=font, size=11, color=MUTED)
    assertions = dataset.get("assertions", []) if isinstance(dataset.get("assertions"), list) else []
    texts = [str(item.get("text", "")) for item in assertions if isinstance(item, dict) and item.get("text")]
    if texts:
        _bullet_list(canvas, texts, 64, 390, 820, font=font, bold=bold)
    else:
        canvas.setFillColor(HexColor("#FFF5DD"))
        canvas.roundRect(54, 310, 850, 90, 8, fill=1, stroke=0)
        _draw_text(canvas, "Пока недостаточно данных для вывода", 76, 360, font=bold, size=16, color=AMBER)
        _draw_text(canvas, "Отчёт не подменяет отсутствующие значения нулями и не придумывает причины изменений.", 76, 334, font=font, size=11, color=INK)
    _draw_text(canvas, "Рекомендации", 54, 150, font=bold, size=18, color=PURPLE)
    recommendations = dataset.get("recommendations", []) if isinstance(dataset.get("recommendations"), list) else []
    recommendation_texts = [str(item.get("text", "")) for item in recommendations if isinstance(item, dict) and item.get("text")]
    if recommendation_texts:
        _bullet_list(canvas, recommendation_texts, 64, 118, 820, font=font, bold=bold, max_items=3)
    else:
        _draw_text(canvas, "Рекомендации появятся после получения достаточного набора данных.", 64, 112, font=font, size=11, color=MUTED)
    canvas.showPage()

    # Limitations and method
    canvas.setFillColor(HexColor(PURPLE_LIGHT))
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    _page_header(canvas, "Ограничения и методология", 6, font=font, bold=bold)
    _draw_text(canvas, "Что вошло в отчёт", 54, 438, font=bold, size=18, color=PURPLE)
    _draw_wrapped(canvas, "Данные собраны через HolyMedia MCP из подключённого рекламного кабинета. Значения агрегированы за выбранный период, сравнение рассчитано локально.", 54, 410, 420, font=font, size=12, leading=18, color=INK, max_lines=4)
    _draw_text(canvas, "Что пока не подтверждено", 510, 438, font=bold, size=18, color=PURPLE)
    limitations = [str(item) for item in dataset.get("limitations", []) if item]
    unknowns = [str(item) for item in dataset.get("unknowns", []) if item]
    pending = [str(item) for item in dataset.get("pending_sections", []) if item]
    limitation_lines = limitations + ([f"Нет значения: {item}" for item in unknowns] if unknowns else []) + ([f"Не загружено: {item}" for item in pending] if pending else [])
    if limitation_lines:
        _bullet_list(canvas, limitation_lines, 520, 402, 350, font=font, bold=bold, max_items=7)
    else:
        _draw_text(canvas, "Ограничения не заявлены.", 520, 402, font=font, size=12, color=MUTED)
    canvas.setFillColor(HexColor(WHITE))
    canvas.roundRect(54, 90, 850, 100, 8, fill=1, stroke=0)
    _draw_text(canvas, "Свежесть данных", 76, 158, font=bold, size=12, color=PURPLE)
    _draw_text(canvas, f"Источник: {source.get('source_api') or 'не указан'}", 76, 132, font=font, size=11, color=INK)
    _draw_text(canvas, f"Статус: {source.get('data_status') or 'не указан'} · Получено: {source.get('fetched_at') or '—'}", 76, 110, font=font, size=11, color=INK)
    canvas.showPage()

    # Closing
    canvas.setFillColor(HexColor(PURPLE))
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#6A3D82"))
    canvas.circle(830, 110, 170, fill=1, stroke=0)
    _draw_text(canvas, "Спасибо за внимание", 260, 286, font=bold, size=34, color=WHITE)
    _draw_text(canvas, "Отчёт подготовлен в HolyMedia MCP", 330, 240, font=font, size=13, color="#DCC7E6")
    _draw_text(canvas, f"{account_name} · {start} — {end}", 350, 70, font=font, size=11, color="#DCC7E6")
    canvas.showPage()
    canvas.save()
    return buffer.getvalue()
