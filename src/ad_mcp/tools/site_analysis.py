from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import hashlib
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


MAX_HTML_BYTES = 350_000
TIMEOUT_SECONDS = 10
MAX_REDIRECTS = 4
FIRST_SCREEN_LIMIT = 40
MAX_FACT_ITEMS = 24
BOOKING_CTA_KEYWORDS = [
    "book",
    "booking",
    "reserve",
    "availability",
    "room",
    "rooms",
    "price",
    "date",
    "dates",
    "забронировать",
    "бронь",
    "бронировать",
    "номера",
    "номер",
    "свободные",
    "даты",
    "цена",
    "стоимость",
]
BOOKING_CTA_STRONG_KEYWORDS = [
    "book",
    "booking",
    "reserve",
    "availability",
    "check availability",
    "забронировать",
    "бронь",
    "бронировать",
    "проверить",
    "свободные",
    "узнать цену",
    "цена на даты",
    "номера и цены",
]
GENERIC_SUBMIT_WORDS = {"отправить", "submit", "send", "ok", "далее"}
CTA_NOISE_WORDS = {"ru", "kz", "en", "cn", "главная", "вернуться назад", "назад", "стать участником"}

NICHE_KEYWORDS: dict[str, list[str]] = {
    "hotel": ["отель", "гостиниц", "hotel", "номер", "номера", "rooms", "проживание", "заезд", "выезд", "booking", "брон"],
    "clinic": ["клиник", "врач", "пациент", "лечение", "диагност", "прием", "записаться", "стоматолог", "медицин", "clinic", "doctor", "patient", "diagnostic", "treatment", "appointment"],
    "logistics": ["логист", "доставка", "груз", "перевоз", "склад", "фулфил", "транспорт", "экспед", "logistics", "delivery", "cargo", "freight", "warehouse"],
    "ecommerce": ["купить", "корзина", "каталог", "товар", "доставка", "оплата", "заказ", "скидка", "магазин", "shop", "cart", "catalog", "product", "checkout"],
    "b2b_services": ["b2b", "агентство", "услуги для бизнеса", "внедрение", "интеграц", "аудит", "консалт", "digital"],
    "restaurant": ["ресторан", "меню", "бронь стола", "доставка еды", "кухня", "банкет", "завтрак", "бар", "restaurant", "menu", "table booking", "cuisine"],
    "real_estate": ["недвиж", "квартир", "жк", "ипотек", "застройщик", "новострой", "планиров", "площадь", "real estate", "apartment", "mortgage", "developer"],
    "education": ["курс", "обучение", "программа", "студент", "урок", "преподав", "школа", "университет", "course", "education", "student", "lesson", "school", "university"],
    "generic_landing": ["заявка", "консультация", "оффер", "получить", "заказать", "рассчитать"],
}


class SiteAnalysisError(ValueError):
    pass


class _SafeRedirectHandler(HTTPRedirectHandler):
    def __init__(self) -> None:
        super().__init__()
        self.redirect_count = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, D401
        self.redirect_count += 1
        if self.redirect_count > MAX_REDIRECTS:
            raise SiteAnalysisError("Сайт сделал слишком много перенаправлений.")
        normalized = _validate_public_url(urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, normalized)


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.meta_description = ""
        self.meta_robots = ""
        self.viewport = False
        self.canonical = False
        self.structured_data = False
        self.h1: list[str] = []
        self.h2: list[str] = []
        self.h3: list[str] = []
        self.links = 0
        self.link_texts: list[str] = []
        self.images = 0
        self.images_without_alt = 0
        self.buttons = 0
        self.button_texts: list[str] = []
        self.forms = 0
        self.inputs = 0
        self.phone_links = 0
        self.email_links = 0
        self.whatsapp_links = 0
        self._capture: str | None = None
        self._buffer: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): (value or "") for key, value in attrs}
        tag = tag.lower()
        if tag in {"title", "h1", "h2", "h3", "button", "a"}:
            self._capture = tag
            self._buffer = []
        if tag == "meta":
            name = attrs_dict.get("name", "").lower()
            if name == "description":
                self.meta_description = attrs_dict.get("content", "").strip()
            if name == "viewport":
                self.viewport = True
            if name == "robots":
                self.meta_robots = attrs_dict.get("content", "").strip()
        if tag == "link" and "canonical" in attrs_dict.get("rel", "").lower():
            self.canonical = True
        if tag == "script" and attrs_dict.get("type", "").lower() in {"application/ld+json", "application/json+ld"}:
            self.structured_data = True
        if tag == "a" and attrs_dict.get("href"):
            href = attrs_dict["href"].lower()
            self.links += 1
            if href.startswith("tel:"):
                self.phone_links += 1
            if href.startswith("mailto:"):
                self.email_links += 1
            if "wa.me" in href or "whatsapp" in href:
                self.whatsapp_links += 1
        if tag == "img":
            self.images += 1
            if not attrs_dict.get("alt", "").strip():
                self.images_without_alt += 1
        if tag == "button":
            self.buttons += 1
        if tag == "form":
            self.forms += 1
        if tag in {"input", "textarea", "select"}:
            self.inputs += 1

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self._capture == tag:
            value = _clean_text(" ".join(self._buffer))
            if tag == "title":
                self.title = value
            elif tag == "h1" and value:
                self.h1.append(value)
            elif tag == "h2" and value:
                self.h2.append(value)
            elif tag == "h3" and value:
                self.h3.append(value)
            elif tag == "button" and value:
                self.button_texts.append(value)
            elif tag == "a" and value:
                self.link_texts.append(value)
            self._capture = None
            self._buffer = []

    def handle_data(self, data: str) -> None:
        text = _clean_text(data)
        if not text:
            return
        if self._capture:
            self._buffer.append(text)
        self.text_parts.append(text)


def analyze_site_improvements(
    url: str,
    *,
    site_type: str = "",
    goal: str = "",
    audience: str = "",
    region: str = "",
    mode: str = "quick",
    competitor: str = "",
    concern: str = "",
) -> dict[str, Any]:
    normalized = _validate_public_url(url)
    try:
        request = Request(
            normalized,
            headers={
                "User-Agent": "HolyMedia-MCP-SiteAnalysis/2.0",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        opener = build_opener(_SafeRedirectHandler())
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310 - URL is validated against SSRF targets.
            final_url = _validate_public_url(str(response.geturl() or normalized))
            content_type = str(response.headers.get("content-type", ""))
            status = int(getattr(response, "status", 200) or 200)
            raw = response.read(MAX_HTML_BYTES + 1)
        if "html" not in content_type.lower():
            raise SiteAnalysisError("Ссылка открылась, но это не HTML-страница.")
        truncated = len(raw) > MAX_HTML_BYTES
        html = raw[:MAX_HTML_BYTES].decode(_charset_from_content_type(content_type), errors="replace")
    except HTTPError as exc:
        return _error_result(normalized, f"Сайт вернул HTTP {exc.code}. Проверьте URL или доступность страницы.")
    except (URLError, TimeoutError, OSError, SiteAnalysisError) as exc:
        return _error_result(normalized, str(exc) or "Не удалось открыть сайт.")

    return analyze_html(
        html,
        url=final_url,
        http_status=status,
        truncated=truncated,
        site_type=site_type,
        goal=goal,
        audience=audience,
        region=region,
        mode=mode,
        competitor=competitor,
        concern=concern,
    )


def analyze_html(
    html: str,
    *,
    url: str = "",
    http_status: int = 200,
    truncated: bool = False,
    site_type: str = "",
    goal: str = "",
    audience: str = "",
    region: str = "",
    mode: str = "quick",
    competitor: str = "",
    concern: str = "",
    audit_facts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    parser = _PageParser()
    parser.feed(html)
    soup_facts = _extract_with_beautifulsoup(html)
    _normalize_parser(parser, audit_facts)
    text = _clean_text(" ".join(parser.text_parts))
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]{3,}", text)
    signals = _signals(parser, text, audit_facts)
    context = _context(site_type, goal, audience, region, mode, competitor, concern)
    context = _apply_detected_vertical(context, signals)
    scores = _scorecards(parser, len(words), signals, context)
    top_issues = _business_top_issues(_top_issues(parser, len(words), signals, context, scores), context)
    technical_notes = _technical_notes(parser, signals, context)
    quick_wins = _quick_wins(parser, signals, context)
    rewritten_copy = _rewritten_copy(parser, context)
    implementation_plan = _implementation_plan(top_issues, quick_wins)
    result = {
        "status": "ok",
        "url": url,
        "http_status": http_status,
        "mode": context["mode"],
        "summary": _summary(parser, len(words), signals, context),
        "verdict": _verdict(parser, len(words), signals, context, scores),
        "assumptions": context["assumptions"],
        "scores": scores,
        "scorecards": scores,
        "top_issues": top_issues[:10 if context["mode"] == "full" else 6],
        "technical_notes": technical_notes,
        "quick_wins": quick_wins,
        "rewritten_copy": rewritten_copy,
        "recommended_structure": _recommended_structure(context),
        "implementation_plan": implementation_plan,
        "priority_matrix": implementation_plan,
        "questions": _questions(context),
        "evidence": _evidence(parser, text, audit_facts),
        "priority_recommendations": _legacy_recommendations(top_issues),
        "checks": {
            "title": parser.title,
            "meta_description_present": bool(parser.meta_description),
            "h1_count": len(parser.h1),
            "h2_count": len(parser.h2),
            "h3_count": len(parser.h3),
            "viewport_present": parser.viewport,
            "canonical_present": parser.canonical,
            "meta_robots": parser.meta_robots,
            "structured_data_present": parser.structured_data,
            "links_count": parser.links,
            "images_count": parser.images,
            "images_without_alt": parser.images_without_alt,
            "forms_count": parser.forms,
            "buttons_count": parser.buttons,
            "phone_links": parser.phone_links,
            "email_links": parser.email_links,
            "whatsapp_links": parser.whatsapp_links,
            "cta_mentions": signals["cta_matches"],
            "trust_signals": signals["trust_matches"],
            "detected_vertical": context.get("vertical", "generic"),
            "hotel_signals": {
                "hotel_mentions": signals.get("hotel_matches", []),
                "booking_mentions": signals.get("hotel_booking_matches", []),
                "direct_booking_mentions": signals.get("hotel_direct_booking_matches", []),
                "rooms_mentions": signals.get("hotel_room_matches", []),
                "ota_mentions": signals.get("hotel_ota_matches", []),
                "availability_mentions": signals.get("hotel_availability_matches", []),
                "transport_mentions": signals.get("hotel_transport_matches", []),
                "faq_mentions": signals.get("hotel_faq_matches", []),
                "booking_ctas": signals.get("booking_ctas", []),
            },
            "niche_scores": signals.get("niche_scores", {}),
            "audit_engine": {
                "rendered_dom_used": bool((audit_facts or {}).get("engine", {}).get("rendered_dom_used")),
                "render_reason": (audit_facts or {}).get("engine", {}).get("render_reason", ""),
                "screenshot_captured": bool((audit_facts or {}).get("screenshot", {}).get("captured")),
                "first_screen_blocks": len((audit_facts or {}).get("first_screen_blocks", [])),
                "extraction_method": (audit_facts or {}).get("extraction_method", "html_parser"),
                "pagespeed": (audit_facts or {}).get("pagespeed", {"enabled": False}),
            },
            "word_count": len(words),
            "truncated": truncated,
            "technical_check_limited": True,
        },
    }
    overall = _overall_score(scores, signals, context)
    result["overall_score"] = overall
    return _sanitize_result(result)


def analyze_site_improvements(
    url: str,
    *,
    site_type: str = "",
    goal: str = "",
    audience: str = "",
    region: str = "",
    mode: str = "quick",
    competitor: str = "",
    concern: str = "",
) -> dict[str, Any]:
    normalized = _validate_public_url(url)
    try:
        page = _collect_page_evidence(normalized)
    except HTTPError as exc:
        return _error_result(normalized, f"Сайт вернул HTTP {exc.code}. Проверьте URL или доступность страницы.")
    except (URLError, TimeoutError, OSError, SiteAnalysisError) as exc:
        return _error_result(normalized, str(exc) or "Не удалось открыть сайт.")
    return analyze_html(
        page["html"],
        url=page["final_url"],
        http_status=page["status"],
        truncated=page["truncated"],
        site_type=site_type,
        goal=goal,
        audience=audience,
        region=region,
        mode=mode,
        competitor=competitor,
        concern=concern,
        audit_facts=page["facts"],
    )


def _collect_page_evidence(url: str) -> dict[str, Any]:
    static_page = _fetch_static_html(url)
    rendered = _rendered_page_evidence(static_page["final_url"])
    html = str(rendered.get("html") or static_page["html"])
    facts = _extract_audit_facts(
        html,
        str(rendered.get("final_url") or static_page["final_url"]),
        rendered_facts=rendered.get("facts") if rendered.get("html") else None,
        screenshot=rendered.get("screenshot"),
        engine_status={
            "static_html_used": True,
            "rendered_dom_used": bool(rendered.get("html")),
            "render_reason": str(rendered.get("reason", "")),
            "content_type": static_page["content_type"],
        },
    )
    return {
        "html": html,
        "final_url": str(rendered.get("final_url") or static_page["final_url"]),
        "status": int(rendered.get("status") or static_page["status"]),
        "truncated": bool(static_page["truncated"] or rendered.get("truncated")),
        "facts": facts,
    }


def _fetch_static_html(url: str) -> dict[str, Any]:
    request = Request(
        url,
        headers={
            "User-Agent": "HolyMedia-MCP-SiteAnalysis/2.1",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    opener = build_opener(_SafeRedirectHandler())
    with opener.open(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310 - URL is validated against SSRF targets.
        final_url = _validate_public_url(str(response.geturl() or url))
        content_type = str(response.headers.get("content-type", ""))
        status = int(getattr(response, "status", 200) or 200)
        raw = response.read(MAX_HTML_BYTES + 1)
    if "html" not in content_type.lower():
        raise SiteAnalysisError("Ссылка открылась, но это не HTML-страница.")
    return {
        "html": raw[:MAX_HTML_BYTES].decode(_charset_from_content_type(content_type), errors="replace"),
        "final_url": final_url,
        "status": status,
        "content_type": content_type,
        "truncated": len(raw) > MAX_HTML_BYTES,
    }


def _rendered_page_evidence(url: str) -> dict[str, Any]:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except Exception:
        return {"reason": "playwright_not_installed"}

    def _route_guard(route: Any) -> None:
        request_url = route.request.url
        parsed = urlparse(request_url)
        if parsed.scheme not in {"http", "https"}:
            route.abort()
            return
        try:
            _validate_public_url(request_url)
        except SiteAnalysisError:
            route.abort()
            return
        route.continue_()

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage", "--no-sandbox"])
            page = browser.new_page(viewport={"width": 1365, "height": 768}, java_script_enabled=True)
            page.route("**/*", _route_guard)
            response = page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT_SECONDS * 1000)
            final_url = _validate_public_url(page.url)
            try:
                page.wait_for_load_state("networkidle", timeout=2500)
            except PlaywrightError:
                pass
            first_screen = page.evaluate(
                """
                () => Array.from(document.body.querySelectorAll('h1,h2,h3,p,a,button,[role="button"],input,textarea,select,form,section,article,header'))
                  .map((el) => {
                    const rect = el.getBoundingClientRect();
                    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim();
                    return { tag: el.tagName.toLowerCase(), text, top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height), href: el.href || '' };
                  })
                  .filter((item) => item.text && item.height > 0 && item.width > 0 && item.top < window.innerHeight && item.top >= -20)
                  .slice(0, 40)
                """
            )
            screenshot = page.screenshot(full_page=False, type="png", timeout=5000)
            html = page.content()[:MAX_HTML_BYTES]
            browser.close()
        return {
            "html": html,
            "final_url": final_url,
            "status": int(response.status if response else 200),
            "truncated": len(html) >= MAX_HTML_BYTES,
            "screenshot": {
                "captured": True,
                "mime": "image/png",
                "bytes": len(screenshot),
                "sha256": hashlib.sha256(screenshot).hexdigest(),
            },
            "facts": {"first_screen_blocks": first_screen},
        }
    except Exception as exc:
        return {"reason": f"render_failed:{type(exc).__name__}"}


def _extract_audit_facts(
    html: str,
    url: str,
    *,
    rendered_facts: dict[str, Any] | None = None,
    screenshot: dict[str, Any] | None = None,
    engine_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    parser = _PageParser()
    parser.feed(html)
    soup_facts = _extract_with_beautifulsoup(html)
    text = _clean_text(" ".join(parser.text_parts))
    links = _extract_links(html, url)
    structured = _extract_structured_data(html)
    first_screen_blocks = _dedupe_blocks((rendered_facts or {}).get("first_screen_blocks") or _fallback_first_screen_blocks(parser))
    cta_candidates = _extract_cta_candidates(html, first_screen_blocks)
    ctas = [item["text"] for item in cta_candidates][:MAX_FACT_ITEMS]
    images = _extract_images(html)
    facts = {
        "engine": engine_status or {"static_html_used": True, "rendered_dom_used": False},
        "extraction_method": "beautifulsoup" if soup_facts else "html_parser",
        "url": url,
        "title": soup_facts.get("title") or parser.title,
        "description": soup_facts.get("description") or parser.meta_description,
        "h1": (soup_facts.get("h1") or parser.h1)[:MAX_FACT_ITEMS],
        "h2": _unique((soup_facts.get("h2") or parser.h2))[:MAX_FACT_ITEMS],
        "h3": _unique((soup_facts.get("h3") or parser.h3))[:MAX_FACT_ITEMS],
        "cta_texts": ctas,
        "cta_candidates": cta_candidates[:MAX_FACT_ITEMS],
        "forms": {"count": parser.forms, "inputs": parser.inputs},
        "contacts": {
            "phone_links": parser.phone_links,
            "email_links": parser.email_links,
            "whatsapp_links": parser.whatsapp_links,
            "phones": _unique(re.findall(r"(?:\+?\d[\d\s().-]{7,}\d)", text))[:8],
            "emails": _unique(re.findall(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text))[:8],
        },
        "links": links,
        "images": images,
        "structured_data": structured,
        "word_count": len(re.findall(r"[A-Za-zА-Яа-яЁё0-9]{3,}", text)),
        "first_screen_blocks": first_screen_blocks[:FIRST_SCREEN_LIMIT],
        "first_screen_text": _clean_text(" ".join(item.get("text", "") for item in first_screen_blocks))[:1500],
        "screenshot": screenshot or {"captured": False},
        "accessibility": _accessibility_signals(parser, images),
        "pagespeed": _pagespeed_signals(url),
    }
    return facts


def _extract_with_beautifulsoup(html: str) -> dict[str, Any]:
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return {}
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")
    title = _clean_text(soup.title.get_text(" ")) if soup.title else ""
    description_node = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    description = _clean_text(str(description_node.get("content", ""))) if description_node else ""
    return {
        "title": title,
        "description": description,
        "h1": [_clean_text(node.get_text(" ")) for node in soup.find_all("h1") if _clean_text(node.get_text(" "))],
        "h2": [_clean_text(node.get_text(" ")) for node in soup.find_all("h2") if _clean_text(node.get_text(" "))],
        "h3": [_clean_text(node.get_text(" ")) for node in soup.find_all("h3") if _clean_text(node.get_text(" "))],
    }


def _extract_cta_candidates(html: str, first_screen_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for text in _unique(_extract_attr_values(html, "aria-label") + _extract_attr_values(html, "title")):
        _append_cta_candidate(candidates, text=text, href="", source="attribute")
    try:
        from bs4 import BeautifulSoup
    except Exception:
        for text in _unique(re.findall(r"<(?:button|a)\b[^>]*>(.*?)</(?:button|a)>", html, flags=re.I | re.S)):
            clean = _clean_text(re.sub(r"<[^>]+>", " ", text))
            _append_cta_candidate(candidates, text=clean, href="", source="html")
    else:
        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            soup = BeautifulSoup(html, "html.parser")
        selector = "a, button, [role='button'], input[type='submit'], input[type='button']"
        for node in soup.select(selector)[:350]:
            text = _clean_text(node.get_text(" ") or str(node.get("value", "")) or str(node.get("aria-label", "")) or str(node.get("title", "")))
            href = _clean_text(str(node.get("href", "")))
            _append_cta_candidate(candidates, text=text, href=href, source=node.name or "element")
    for item in first_screen_blocks:
        if not isinstance(item, dict) or item.get("tag") not in {"a", "button"}:
            continue
        _append_cta_candidate(candidates, text=str(item.get("text", "")), href=str(item.get("href", "")), source=f"first_screen_{item.get('tag', '')}")
    return _rank_cta_candidates(candidates)


def _append_cta_candidate(candidates: list[dict[str, Any]], *, text: str, href: str, source: str) -> None:
    text = _clean_text(text)
    href = _clean_text(href)
    if not text and not href:
        return
    if not text and href:
        text = _text_from_href(href)
    lowered_text = text.lower()
    haystack = f"{text} {href}".lower()
    booking_related = any(keyword in haystack for keyword in BOOKING_CTA_STRONG_KEYWORDS) or lowered_text in {"номера", "rooms"}
    if lowered_text in CTA_NOISE_WORDS:
        return
    if "@" in text:
        return
    if len(text) > 70:
        return
    if lowered_text.count(",") >= 2 and not booking_related:
        return
    generic_submit = lowered_text in GENERIC_SUBMIT_WORDS
    candidates.append(
        {
            "text": text,
            "href": href,
            "source": source,
            "booking_related": booking_related,
            "generic_submit": generic_submit,
        }
    )


def _rank_cta_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    ranked: list[dict[str, Any]] = []
    for item in sorted(
        candidates,
        key=lambda value: (
            not bool(value.get("booking_related")),
            bool(value.get("generic_submit")),
            0 if str(value.get("source", "")).startswith("first_screen") else 1,
            _cta_source_priority(str(value.get("source", ""))),
            len(str(value.get("text", ""))),
        ),
    ):
        key = _semantic_key(f"{item.get('text', '')} {item.get('href', '')}")
        if not key or key in seen:
            continue
        seen.add(key)
        ranked.append(item)
    return ranked[:MAX_FACT_ITEMS]


def _cta_source_priority(source: str) -> int:
    if source in {"button", "input", "first_screen_button"}:
        return 0
    if source in {"a", "first_screen_a"}:
        return 1
    if source == "attribute":
        return 2
    return 3


def _extract_attr_values(html: str, attr: str) -> list[str]:
    return re.findall(rf"\b{re.escape(attr)}=[\"']([^\"']+)[\"']", html, flags=re.I)


def _text_from_href(href: str) -> str:
    value = re.sub(r"[_/#?=&.-]+", " ", href)
    value = _clean_text(value)
    return value[-70:] if len(value) > 70 else value


def _dedupe_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in blocks:
        if not isinstance(item, dict):
            continue
        text = _clean_text(str(item.get("text", "")))
        key = f"{item.get('tag', '')}:{_semantic_key(text)}"
        if not text or key in seen:
            continue
        seen.add(key)
        clean_item = dict(item)
        clean_item["text"] = text
        result.append(clean_item)
    return result[:FIRST_SCREEN_LIMIT]


def _extract_links(html: str, base_url: str) -> dict[str, Any]:
    hrefs = re.findall(r"<a\b[^>]*?href=[\"']([^\"']+)[\"']", html, flags=re.I)
    base_host = urlparse(base_url).hostname or ""
    samples: list[str] = []
    internal = external = 0
    for href in hrefs[:300]:
        absolute = urljoin(base_url, href)
        host = urlparse(absolute).hostname or ""
        if not host or host == base_host:
            internal += 1
        else:
            external += 1
        if len(samples) < 12:
            samples.append(absolute)
    return {"count": len(hrefs), "internal_count": internal, "external_count": external, "samples": samples}


def _extract_images(html: str) -> dict[str, Any]:
    images = re.findall(r"<img\b([^>]*)>", html, flags=re.I)
    without_alt = 0
    missing_samples: list[str] = []
    for attrs in images:
        src_match = re.search(r"src=[\"']([^\"']+)[\"']", attrs, flags=re.I)
        alt_match = re.search(r"alt=[\"']([^\"']*)[\"']", attrs, flags=re.I)
        if not alt_match or not alt_match.group(1).strip():
            without_alt += 1
            if len(missing_samples) < 8:
                missing_samples.append(src_match.group(1) if src_match else "img без src")
    return {"count": len(images), "without_alt": without_alt, "missing_alt_samples": missing_samples}


def _extract_structured_data(html: str) -> dict[str, Any]:
    scripts = re.findall(r"<script\b[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", html, flags=re.I | re.S)
    types: list[str] = []
    for raw in scripts[:8]:
        try:
            data = json.loads(raw.strip())
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict):
                value = item.get("@type")
                if isinstance(value, str):
                    types.append(value)
                elif isinstance(value, list):
                    types.extend(str(part) for part in value[:3])
    return {"present": bool(scripts), "count": len(scripts), "types": _unique(types)[:12]}


def _fallback_first_screen_blocks(parser: _PageParser) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for tag, values in (("h1", parser.h1), ("h2", parser.h2), ("h3", parser.h3), ("button", parser.button_texts), ("a", parser.link_texts)):
        for value in values[:8]:
            blocks.append({"tag": tag, "text": value})
    for value in [part for part in parser.text_parts if len(part) > 24][:16]:
        blocks.append({"tag": "text", "text": value})
    return blocks[:FIRST_SCREEN_LIMIT]


def _accessibility_signals(parser: _PageParser, images: dict[str, Any]) -> dict[str, Any]:
    return {
        "images_without_alt": images.get("without_alt", parser.images_without_alt),
        "empty_buttons": max(0, parser.buttons - len(parser.button_texts)),
        "forms_without_visible_fields": parser.forms > 0 and parser.inputs == 0,
        "note": "Быстрая проверка доступности: alt, пустые кнопки и базовая структура форм.",
    }


def _pagespeed_signals(url: str) -> dict[str, Any]:
    if os.getenv("AD_MCP_SITE_AUDIT_PAGESPEED", "").lower() not in {"1", "true", "yes"}:
        return {"enabled": False, "reason": "disabled"}
    try:
        api_url = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&url=" + url
        request = Request(api_url, headers={"User-Agent": "HolyMedia-MCP-SiteAnalysis/2.1"})
        with build_opener().open(request, timeout=8) as response:  # noqa: S310 - Google endpoint, target URL is encoded in query.
            payload = json.loads(response.read(200_000).decode("utf-8", errors="replace"))
        lighthouse = payload.get("lighthouseResult", {}).get("categories", {})
        return {
            "enabled": True,
            "performance": round(float(lighthouse.get("performance", {}).get("score", 0)) * 100),
            "accessibility": round(float(lighthouse.get("accessibility", {}).get("score", 0)) * 100),
            "best_practices": round(float(lighthouse.get("best-practices", {}).get("score", 0)) * 100),
        }
    except Exception as exc:
        return {"enabled": True, "error": type(exc).__name__}


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        clean = _clean_text(str(value))
        key = clean.lower()
        if not clean or key in seen:
            continue
        seen.add(key)
        result.append(clean)
    return result


def _normalize_parser(parser: _PageParser, audit_facts: dict[str, Any] | None = None) -> None:
    facts = audit_facts or {}
    parser.h1 = _unique(parser.h1)
    parser.h2 = _unique(parser.h2)
    parser.h3 = _unique(parser.h3)
    parser.button_texts = _unique(parser.button_texts + [item.get("text", "") for item in facts.get("cta_candidates", []) if isinstance(item, dict) and item.get("text")])
    parser.link_texts = _unique(parser.link_texts)


def _overall_score(scores: list[dict[str, Any]], signals: dict[str, Any], context: dict[str, Any]) -> int:
    if not scores:
        return 0
    if not _is_hotel_context(context):
        return round(sum(item["score"] for item in scores) / max(1, len(scores)))
    weights = {
        "Прямое бронирование": 1.45,
        "CTA бронирования": 1.35,
        "Номера и категории": 1.2,
        "Доверие и выбор отеля": 1.1,
        "UX booking-сценария": 1.25,
        "Базовая техническая видимость": 0.55,
    }
    total = 0.0
    weight_sum = 0.0
    for item in scores:
        weight = weights.get(str(item.get("area")), 1.0)
        total += int(item.get("score", 0)) * weight
        weight_sum += weight
    overall = round(total / max(1.0, weight_sum))
    return min(overall, _hotel_score_cap(signals))


def _business_top_issues(items: list[dict[str, str]], context: dict[str, Any]) -> list[dict[str, str]]:
    if not _is_hotel_context(context):
        return _dedupe_issues(items)
    technical_words = {"alt", "meta", "html", "viewport", "изображен", "описать ключевые фото"}
    business: list[dict[str, str]] = []
    for item in items:
        title = item.get("title", "")
        key = title.lower()
        if item.get("priority") == "P3" or any(word in key for word in technical_words):
            continue
        business.append(item)
    return _dedupe_issues(business)


def _technical_notes(parser: _PageParser, signals: dict[str, Any], context: dict[str, Any]) -> list[dict[str, str]]:
    notes: list[dict[str, str]] = []
    if parser.images_without_alt:
        notes.append(
            {
                "title": "Изображения без alt",
                "detail": f"Найдено изображений без alt: {parser.images_without_alt} из {parser.images}. Это полезно исправить, но это не главный конверсионный приоритет.",
                "priority": "low",
            }
        )
    if not parser.meta_description:
        notes.append({"title": "Meta description не найден", "detail": "Добавьте короткое описание страницы после бизнесовых правок оффера и CTA.", "priority": "low"})
    if not parser.viewport:
        notes.append({"title": "Viewport meta не найден", "detail": "Проверьте мобильную адаптацию и добавьте viewport meta.", "priority": "medium"})
    if not parser.structured_data and _is_hotel_context(context):
        notes.append({"title": "Structured data для отеля не обнаружены", "detail": "После правок контента можно добавить Hotel/LocalBusiness schema.", "priority": "low"})
    return notes[:8]


def _display_cta_texts(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in _unique(values):
        lowered = value.lower()
        if lowered in CTA_NOISE_WORDS:
            continue
        if "@" in value:
            continue
        if re.search(r"\+\d[\d\s().-]{7,}", value):
            continue
        if len(value) > 70:
            continue
        if lowered.count(",") >= 2:
            continue
        if lowered in GENERIC_SUBMIT_WORDS and result:
            continue
        result.append(value)
        if len(result) >= 8:
            break
    return result or ["не обнаружено в собранных данных"]


def _sanitize_result(result: dict[str, Any]) -> dict[str, Any]:
    result["top_issues"] = _dedupe_issues(result.get("top_issues", []))
    evidence = result.get("evidence", {})
    if isinstance(evidence, dict):
        for key in ("h1", "h2", "h3", "buttons", "links_text", "text_snippets"):
            if isinstance(evidence.get(key), list):
                evidence[key] = _unique([str(item) for item in evidence[key]])
        audit = evidence.get("audit_engine", {})
        if isinstance(audit, dict):
            audit["first_screen_blocks"] = _dedupe_blocks(audit.get("first_screen_blocks", []))
            audit["cta_texts"] = _display_cta_texts([str(item) for item in audit.get("cta_texts", [])])
    verdict = result.get("verdict", {})
    if isinstance(verdict, dict):
        for key, value in list(verdict.items()):
            if isinstance(value, str):
                verdict[key] = _clean_repeated_phrases(value)
    if isinstance(result.get("summary"), str):
        result["summary"] = _clean_repeated_phrases(result["summary"])
    return result


def _clean_repeated_phrases(value: str) -> str:
    clean = _clean_text(value)
    clean = re.sub(r"^(Главный риск:\s*){2,}", "Главный риск: ", clean, flags=re.I)
    clean = re.sub(r"^(Самый быстрый выигрыш\s*[—-]\s*){2,}", "Самый быстрый выигрыш — ", clean, flags=re.I)
    return clean


def _semantic_key(value: str) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", " ", (value or "").lower()).strip()


def build_site_analysis_tools() -> dict[str, callable]:
    return {"analyze_site_improvements": analyze_site_improvements}


def _context(site_type: str, goal: str, audience: str, region: str, mode: str, competitor: str, concern: str) -> dict[str, Any]:
    clean_mode = mode if mode in {"quick", "full"} else "quick"
    assumptions: list[str] = []
    if not site_type:
        site_type = "услуги"
        assumptions.append("Тип сайта не указан: анализ выполнен как для сайта услуг.")
    if not goal:
        goal = "заявки"
        assumptions.append("Цель не указана: считаем основной целью получение заявок.")
    if not audience:
        assumptions.append("Целевая аудитория не указана: выводы сделаны по видимым текстам страницы.")
    return {
        "site_type": _clean_text(site_type),
        "goal": _clean_text(goal),
        "audience": _clean_text(audience),
        "region": _clean_text(region),
        "mode": clean_mode,
        "competitor": _clean_text(competitor),
        "concern": _clean_text(concern),
        "assumptions": assumptions,
    }


def _signals(parser: _PageParser, text: str, audit_facts: dict[str, Any] | None = None) -> dict[str, Any]:
    facts = audit_facts or {}
    facts_text = " ".join(
        [
            str(facts.get("first_screen_text", "")),
            " ".join(str(item) for item in facts.get("cta_texts", [])),
            " ".join(str(item.get("text", "")) for item in facts.get("first_screen_blocks", []) if isinstance(item, dict)),
        ]
    )
    lower = f"{text} {facts_text}".lower()
    hotel = _matches(lower, ["отель", "гостиниц", "hotel", "номер", "номера", "rooms", "проживание", "заезд", "выезд"])
    hotel_booking = _matches(lower, ["забронировать", "бронир", "booking", "book now", "проверить свободные", "свободные номера", "даты", "заезд", "выезд"])
    hotel_direct = _matches(lower, ["официальный сайт", "на сайте выгоднее", "лучший тариф", "без комиссии", "прямое бронир", "гарантия цены", "book direct"])
    hotel_rooms = _matches(lower, ["номер", "номера", "категории номеров", "standard", "suite", "люкс", "апартаменты", "room"])
    hotel_ota = _matches(lower, ["booking.com", "ostrovok", "agoda", "expedia", "tripadvisor", "airbnb"])
    hotel_business = _matches(lower, ["бизнес", "командиров", "деловая поездка", "conference", "конференц", "переговор", "мероприят"])
    hotel_food_spa = _matches(lower, ["ресторан", "завтрак", "spa", "спа", "сауна", "бар", "кухня"])
    hotel_location = _matches(lower, ["локац", "центр", "аэропорт", "вокзал", "рядом", "достопримеч", "алматы", "адрес"])
    hotel_reviews = _matches(lower, ["отзывы", "рейтинг", "звезд", "stars", "guest rating", "оценка гостей"])
    hotel_transport = _matches(lower, ["трансфер", "парковка", "parking", "shuttle", "airport transfer", "такси"])
    hotel_faq = _matches(lower, ["заселение", "выезд", "отмена", "оплата", "документ", "faq", "часто задаваем", "check-in", "check-out", "cancellation"])
    hotel_availability = _matches(lower, ["свободные номера", "наличие", "availability", "проверить даты", "check availability", "цена на даты"])
    cta = _matches(lower, ["купить", "заказать", "оставить заявку", "записаться", "получить", "рассчитать", "консультация", "contact", "book", "order"])
    trust = _matches(lower, ["отзывы", "кейс", "сертификат", "гарантия", "партнер", "лет", "клиентов", "лицензия", "команда", "портфолио"])
    price = _matches(lower, ["цена", "стоимость", "тариф", "прайс", "рассчитать"])
    process = _matches(lower, ["как это работает", "этап", "процесс", "шаг", "схема"])
    faq = _matches(lower, ["faq", "вопрос", "ответ", "часто задаваем"])
    niche_scores = {
        niche: sum(1 for keyword in keywords if keyword in lower)
        for niche, keywords in NICHE_KEYWORDS.items()
    }
    first_screen_ctas = [
        str(item.get("text", ""))
        for item in facts.get("first_screen_blocks", [])
        if isinstance(item, dict) and item.get("tag") in {"a", "button"}
    ][:8]
    booking_ctas = [
        str(item.get("text", ""))
        for item in facts.get("cta_candidates", [])
        if isinstance(item, dict) and item.get("booking_related")
    ][:8]
    return {
        "cta_matches": cta,
        "trust_matches": trust,
        "price_matches": price,
        "process_matches": process,
        "faq_matches": faq,
        "hotel_matches": hotel,
        "hotel_booking_matches": hotel_booking,
        "hotel_direct_booking_matches": hotel_direct,
        "hotel_room_matches": hotel_rooms,
        "hotel_ota_matches": hotel_ota,
        "hotel_business_matches": hotel_business,
        "hotel_food_spa_matches": hotel_food_spa,
        "hotel_location_matches": hotel_location,
        "hotel_review_matches": hotel_reviews,
        "hotel_transport_matches": hotel_transport,
        "hotel_faq_matches": hotel_faq,
        "hotel_availability_matches": hotel_availability,
        "niche_scores": niche_scores,
        "first_screen_ctas": _unique(first_screen_ctas)[:8],
        "booking_ctas": _unique(booking_ctas)[:8],
        "has_contacts": parser.phone_links > 0 or parser.email_links > 0 or parser.whatsapp_links > 0,
        "has_form_or_button": parser.forms > 0 or parser.buttons > 0 or bool(cta),
    }


def _apply_detected_vertical(context: dict[str, Any], signals: dict[str, Any]) -> dict[str, Any]:
    site_type = context["site_type"].lower()
    goal = context["goal"].lower()
    niche_scores = signals.get("niche_scores", {})
    detected_vertical = ""
    if isinstance(niche_scores, dict) and niche_scores:
        best_niche, best_score = max(niche_scores.items(), key=lambda item: int(item[1]))
        if int(best_score) >= 2:
            detected_vertical = str(best_niche)
    hotel_score = (
        len(signals.get("hotel_matches", []))
        + len(signals.get("hotel_booking_matches", []))
        + len(signals.get("hotel_room_matches", []))
        + len(signals.get("hotel_business_matches", []))
        + len(signals.get("hotel_food_spa_matches", []))
    )
    is_hotel = any(word in site_type for word in ["отель", "гостини", "hotel"]) or "брон" in goal or hotel_score >= 3
    context["vertical"] = "hotel" if (is_hotel or detected_vertical == "hotel") else (detected_vertical or "generic_landing")
    context["niche_scores"] = niche_scores
    if is_hotel:
        if not any(word in site_type for word in ["отель", "гостини", "hotel"]):
            context["site_type"] = "отель"
        if not context["goal"] or "заяв" in goal:
            context["goal"] = "бронирования"
    return context


def _is_hotel_context(context: dict[str, Any]) -> bool:
    return context.get("vertical") == "hotel"


def _scorecards(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    if _is_hotel_context(context):
        return _hotel_scorecards(parser, word_count, signals)

    first_screen = _score(62, (len(parser.h1) == 1, 12), (bool(parser.h1 and len(parser.h1[0]) >= 28), 10), (signals["has_form_or_button"], 12), (bool(signals["trust_matches"]), 8), (word_count <= 1200, 6))
    offer = _score(55, (bool(parser.h1), 12), (bool(signals["price_matches"] or context["goal"]), 8), (word_count >= 250, 10), (not _looks_generic(parser.h1[0] if parser.h1 else ""), 10))
    cta = _score(45, (signals["has_form_or_button"], 22), (bool(signals["cta_matches"]), 15), (parser.forms > 0, 8), (parser.phone_links + parser.whatsapp_links > 0, 7))
    trust = _score(42, (bool(signals["trust_matches"]), 20), (signals["has_contacts"], 14), (parser.images > 0, 6), (parser.structured_data, 4))
    structure = _score(50, (len(parser.h2) >= 3, 16), (bool(signals["process_matches"]), 10), (bool(signals["faq_matches"]), 8), (word_count >= 450, 10))
    copy = _score(52, (word_count >= 300, 12), (bool(parser.h1 and len(parser.h1[0]) <= 90), 8), (len(parser.h2) >= 2, 8), (not _too_many_caps(parser.title), 4))
    ux = _score(55, (parser.viewport, 20), (signals["has_contacts"], 8), (parser.forms <= 3, 6), (parser.links < 160, 6), (parser.images_without_alt < max(1, parser.images // 2), 5))
    conversion = _score(48, (signals["has_form_or_button"], 20), (bool(signals["trust_matches"]), 10), (signals["has_contacts"], 10), (bool(signals["process_matches"]), 6), (bool(signals["price_matches"]), 6))
    visibility = _score(50, (bool(parser.title and len(parser.title) >= 25), 12), (bool(parser.meta_description), 10), (len(parser.h1) == 1, 10), (parser.viewport, 8), (parser.canonical, 5), (parser.images_without_alt == 0, 5))
    raw = [
        ("Первый экран", first_screen, ["Оффер должен быть понятен за 5 секунд.", "CTA и доверие должны быть видны без лишнего поиска."]),
        ("Оффер", offer, ["Нужна конкретика: что, для кого и почему выбрать вас.", "Слабый оффер снижает качество заявок."]),
        ("CTA", cta, ["Следующий шаг должен быть очевиден.", "Кнопки лучше формулировать как действие с выгодой."]),
        ("Доверие", trust, ["Без доказательств пользователь откладывает заявку.", "Нужны факты, контакты, кейсы или лица команды."]),
        ("Структура", structure, ["Страница должна вести от проблемы к решению и заявке.", "Важно объяснить процесс до финального CTA."]),
        ("Тексты", copy, ["Тексты должны продавать результат, а не описывать компанию общими словами.", "Заголовки должны быть короче и конкретнее."]),
        ("UX", ux, ["Пользователь не должен искать контакты и основной сценарий.", "Мобильная понятность критична для рекламного трафика."]),
        ("Конверсия", conversion, ["Сейчас часть пользователей может не дойти до заявки.", "Нужно усилить доверие и повторить CTA после ключевых блоков."]),
        ("Базовая техническая видимость", visibility, ["Это не SEO-аудит, но базовые title/H1/description помогают странице быть понятной.", "Техническая проверка ограничена HTML-анализом."]),
    ]
    return [{"area": area, "score": score, "explanation": _score_explanation(score), "problems": problems[:3]} for area, score, problems in raw]


def _hotel_scorecards(parser: _PageParser, word_count: int, signals: dict[str, Any]) -> list[dict[str, Any]]:
    booking_cta = bool(signals.get("booking_ctas")) or bool(signals.get("hotel_booking_matches")) or any("book" in item.lower() or "брон" in item.lower() for item in parser.button_texts)
    direct = bool(signals.get("hotel_direct_booking_matches"))
    rooms = bool(signals.get("hotel_room_matches"))
    trust = bool(signals.get("hotel_review_matches") or signals.get("trust_matches") or parser.images > 3)
    business = bool(signals.get("hotel_business_matches"))
    food_spa = bool(signals.get("hotel_food_spa_matches"))
    location = bool(signals.get("hotel_location_matches") or signals["has_contacts"])
    ota_mentions = bool(signals.get("hotel_ota_matches"))

    raw = [
        (
            "Прямое бронирование",
            _score(34, (direct, 22), (booking_cta, 14), (bool(signals.get("price_matches")), 8), (not ota_mentions, 4)),
            [
                "Нужен явный аргумент, почему гостю выгодно бронировать на официальном сайте, а не через OTA/Booking.",
                "Покажите лучший тариф, бонус, бесплатную отмену, ранний заезд или другой понятный direct-booking benefit.",
            ],
        ),
        (
            "CTA бронирования",
            _score(38, (booking_cta, 24), (parser.forms > 0, 10), (parser.phone_links + parser.whatsapp_links > 0, 8)),
            [
                "Основное действие для отеля должно вести к проверке дат, цены или бронированию номера.",
                "CTA должен звучать как действие гостя: проверить номера, узнать цену на даты, забронировать.",
            ],
        ),
        (
            "Номера и категории",
            _score(36, (rooms, 22), (parser.images > 4, 10), (bool(signals.get("price_matches")), 10), (word_count >= 450, 6)),
            [
                "Гость должен быстро понять категории номеров, отличия, фото, вместимость и что входит в стоимость.",
                "Если цены/даты скрыты, нужен быстрый путь к booking engine или запросу цены.",
            ],
        ),
        (
            "Доверие и выбор отеля",
            _score(42, (trust, 20), (location, 10), (parser.structured_data, 6), (signals["has_contacts"], 8)),
            [
                "Для отеля важны отзывы, рейтинг, реальные фото, адрес, локация и понятные контакты.",
                "Нужно дать гостю быстрые причины выбрать именно этот отель.",
            ],
        ),
        (
            "Аудитории: туристы / бизнес / мероприятия",
            _score(32, (business, 18), (food_spa, 10), (len(parser.h2) >= 5, 8), (word_count >= 700, 6)),
            [
                "Отель продаёт разным аудиториям: туристам, бизнес-гостям, участникам мероприятий, гостям ресторана/SPA.",
                "Если все аудитории смешаны, посетитель не видит свой сценарий и хуже доходит до бронирования.",
            ],
        ),
        (
            "Конференции, ресторан и SPA",
            _score(35, (business, 16), (food_spa, 16), (parser.images > 6, 6)),
            [
                "Дополнительные направления отеля должны быть отдельными входами: конференц-зал, ресторан, SPA, мероприятия.",
                "Для каждого направления нужен свой CTA: забронировать зал, посмотреть меню, уточнить условия.",
            ],
        ),
        (
            "UX booking-сценария",
            _score(40, (parser.viewport, 14), (booking_cta, 16), (signals["has_contacts"], 8), (parser.links < 220, 5)),
            [
                "Путь от первого экрана до выбора дат и номера должен быть коротким и очевидным.",
                "На мобильном экране кнопка бронирования и быстрый контакт должны быть доступны без поиска.",
            ],
        ),
        (
            "Базовая техническая видимость",
            _score(48, (bool(parser.title and len(parser.title) >= 25), 10), (bool(parser.meta_description), 8), (len(parser.h1) == 1, 8), (parser.viewport, 10), (parser.images_without_alt < max(1, parser.images // 2), 5)),
            [
                "Это не SEO-аудит, но title, H1, description и alt помогают странице быть понятной людям и системам.",
                "Техническая часть не должна перекрывать главные конверсионные проблемы отеля.",
            ],
        ),
    ]
    return [{"area": area, "score": score, "explanation": _score_explanation(score), "problems": problems[:3]} for area, score, problems in raw]


def _hotel_score_cap(signals: dict[str, Any]) -> int:
    cap = 84
    if not signals.get("hotel_direct_booking_matches"):
        cap = min(cap, 74)
    if not signals.get("hotel_booking_matches") and not signals.get("booking_ctas"):
        cap = min(cap, 70)
    if not signals.get("hotel_availability_matches"):
        cap = min(cap, 76)
    if not signals.get("hotel_room_matches"):
        cap = min(cap, 72)
    if not signals.get("hotel_review_matches") and not signals.get("trust_matches"):
        cap = min(cap, 76)
    return cap


def _top_issues(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any], scores: list[dict[str, Any]]) -> list[dict[str, str]]:
    if _is_hotel_context(context):
        return _hotel_top_issues(parser, word_count, signals, scores)

    issues: list[dict[str, str]] = []
    h1_value = parser.h1[0] if parser.h1 else ""
    buttons = ", ".join(parser.button_texts[:4]) if parser.button_texts else "кнопки не найдены"
    if not parser.h1 or len(parser.h1) != 1 or _looks_generic(parser.h1[0] if parser.h1 else ""):
        issues.append(_issue("Усилить главный заголовок", f"Текущий H1 выглядит слишком общим: “{h1_value or 'не найден'}”.", "Рекламный трафик быстро уходит, если не понимает выгоду.", "Переписать H1 под результат, аудиторию и следующий шаг.", "низкая", "высокий", "P1", "копирайтер", evidence=f"H1: {h1_value or 'не найден'}"))
    if not signals["has_form_or_button"]:
        issues.append(_issue("Добавить заметный CTA", "На странице не найден явный призыв к действию.", "Пользователь может понять услугу, но не совершить целевое действие.", "Добавить кнопку на первом экране и повторить CTA после смысловых блоков.", "низкая", "высокий", "P1", "дизайнер/разработчик", evidence=f"Найденные кнопки: {buttons}"))
    elif not signals["cta_matches"]:
        issues.append(_issue("Сделать CTA более продающим", f"Кнопки есть, но их формулировки выглядят нейтрально: {buttons}.", "Нейтральные кнопки хуже объясняют ценность следующего шага.", f"Заменить основную кнопку на “{_cta_variants(context)[0]}” и повторить её после ключевых блоков.", "низкая", "высокий", "P1", "копирайтер/дизайнер", evidence=f"Кнопки: {buttons}"))
    if not signals["trust_matches"]:
        issues.append(_issue("Добавить блок доверия", "На странице мало доказательств реальности и опыта компании.", "Без доверия заявки становятся дороже, особенно с холодного трафика.", "Добавить кейсы, отзывы, цифры, сертификаты, клиентов или фото команды.", "средняя", "высокий", "P1", "маркетолог", evidence="Сигналы доверия в тексте не найдены или выражены слабо."))
    if len(parser.h2) < 3:
        issues.append(_issue("Пересобрать структуру блоков", f"Найдено мало смысловых разделов H2: {len(parser.h2)}.", "Посетитель не получает аргументы в правильном порядке.", "Добавить блоки: для кого, что получите, как это работает, почему мы, FAQ.", "средняя", "средний", "P2", "дизайнер/копирайтер", evidence=f"H2: {', '.join(parser.h2[:4]) or 'не найдены'}"))
    if not parser.viewport:
        issues.append(_issue("Исправить мобильную адаптацию", "Не найден viewport meta.", "Мобильный рекламный трафик может видеть страницу некорректно.", "Добавить viewport и проверить первый экран на телефоне.", "низкая", "высокий", "P1", "разработчик"))
    if not parser.meta_description:
        issues.append(_issue("Добавить описание страницы", "Нет meta description.", "Это снижает понятность страницы для систем и превью.", "Добавить короткое описание с оффером и CTA.", "низкая", "средний", "P3", "копирайтер", evidence="Meta description не найден."))
    if parser.images_without_alt:
        issues.append(_issue("Описать ключевые изображения", f"Изображений без alt: {parser.images_without_alt} из {parser.images}.", "Системам анализа и пользователям с ассистивными технологиями сложнее понять страницу.", "Добавить alt к важным изображениям, особенно к кейсам, людям и услугам.", "низкая", "низкий", "P3", "разработчик", evidence=f"Images: {parser.images}, without alt: {parser.images_without_alt}"))
    if not signals["process_matches"]:
        issues.append(_issue("Показать процесс работы", "Не найден понятный блок этапов.", "Пользователь не понимает, что произойдёт после заявки.", "Добавить 3-5 шагов: заявка, аудит, предложение, запуск, отчёт.", "средняя", "средний", "P2", "маркетолог/копирайтер", evidence="Слова про этапы/процесс не найдены."))
    if not signals["has_contacts"]:
        issues.append(_issue("Сделать контакты видимыми", "Не найдены явные телефон, email или WhatsApp-ссылка.", "Часть пользователей хочет быстрый контакт без формы.", "Добавить телефон/мессенджер в шапку и финальный CTA.", "низкая", "средний", "P2", "разработчик", evidence="tel/mailto/WhatsApp ссылки не найдены."))
    if word_count < 250:
        issues.append(_issue("Добавить объясняющий контент", f"На странице мало текста для принятия решения: около {word_count} слов.", "Пользователь не получает достаточно аргументов до заявки.", "Коротко раскрыть выгоды, процесс, доказательства и ответы на возражения.", "средняя", "средний", "P2", "копирайтер", evidence=f"Word count: {word_count}"))
    while len(issues) < 10:
        weakest = min(scores, key=lambda item: int(item["score"]))
        title = f"Усилить направление: {weakest['area']}"
        if any(item["title"] == title for item in issues):
            break
        issues.append(_issue(title, weakest["problems"][0], "Это влияет на качество и количество заявок.", "Проверить блок вручную и внедрить правки из плана ниже.", "средняя", "средний", "P2", "маркетолог", evidence=f"Оценка направления: {weakest['score']}/100"))
        if len(issues) > 10:
            break
    return _dedupe_issues(issues)[:10]


def _hotel_top_issues(parser: _PageParser, word_count: int, signals: dict[str, Any], scores: list[dict[str, Any]]) -> list[dict[str, str]]:
    buttons = ", ".join(parser.button_texts[:6]) if parser.button_texts else "кнопки не найдены"
    cta_evidence = _display_cta_texts(list(signals.get("booking_ctas", [])) + parser.button_texts + parser.link_texts)
    if cta_evidence:
        buttons = ", ".join(cta_evidence)
    h2 = ", ".join(parser.h2[:6]) if parser.h2 else "разделы H2 не найдены"
    issues: list[dict[str, str]] = []

    issues.extend([
        _issue(
            "Сделать блок “Почему бронировать на сайте выгоднее”",
            "Даже если на странице есть элементы бронирования, выгода прямого бронирования должна быть видна как отдельный коммерческий аргумент.",
            "Гость сравнивает официальный сайт с Booking/OTA. Если выгода не очевидна, он уходит на агрегатор или откладывает решение.",
            "Вынести рядом с первым CTA 3-4 причины: лучший тариф, бонус при бронировании напрямую, бесплатная отмена, ранний заезд/поздний выезд или прямой контакт с отелем.",
            "средняя",
            "высокий",
            "P1",
            "маркетолог/копирайтер",
            evidence=f"Direct-booking signals: {', '.join(signals.get('hotel_direct_booking_matches', [])) or 'явно не найдены'}",
        ),
        _issue(
            "Сделать CTA бронирования главным действием",
            f"Кнопки и ссылки должны вести гостя к проверке дат и цены, а не просто к общему просмотру страницы. Найдено: {buttons}.",
            "Для отеля главный сценарий — проверить свободные номера, увидеть цену на даты и забронировать.",
            "Закрепить формулировки “Проверить свободные номера”, “Забронировать номер”, “Узнать цену на даты” на первом экране, в блоке номеров и в финале страницы.",
            "низкая",
            "высокий",
            "P1",
            "дизайнер/разработчик",
            evidence=f"Найденные кнопки: {buttons}",
        ),
        _issue(
            "Добавить быстрые причины выбрать этот отель",
            "Пользователь должен за 5-7 секунд увидеть, почему этот отель подходит именно ему.",
            "Цена редко является единственным фактором. Для прямого бронирования нужны локация, рейтинг, фото, завтрак, парковка, сервис и понятные условия.",
            "Добавить компактный блок из 4-6 преимуществ: локация, рейтинг гостей, завтрак, ресторан/SPA, конференц-залы, парковка, трансфер или круглосуточная стойка.",
            "средняя",
            "высокий",
            "P1",
            "маркетолог",
            evidence=f"Trust/location signals: {', '.join((signals.get('hotel_review_matches') or []) + (signals.get('hotel_location_matches') or [])) or 'нужно усилить'}",
        ),
        _issue(
            "Развести аудитории: туристы, бизнес-гости и мероприятия",
            "Отель продаёт разные сценарии, но в общем потоке страницы пользователь может не увидеть свой путь.",
            "Турист ищет локацию и комфорт, бизнес-гость — документы и удобства, организатор — залы и условия мероприятий.",
            "Сделать отдельные карточки или секции: “Для отдыха”, “Для деловой поездки”, “Для конференций и мероприятий” с отдельными CTA.",
            "средняя",
            "средний",
            "P2",
            "маркетолог/копирайтер",
            evidence=f"H2: {h2}",
        ),
        _issue(
            "Связать номера с датами, ценой и бронированием",
            "Блок номеров должен не просто показывать категории, а вести к выбору дат и бронированию.",
            "Гость выбирает конкретный номер под даты, бюджет и количество гостей. Без этой связки путь до покупки длиннее.",
            "Для каждой категории добавить фото, вместимость, что входит в стоимость и CTA “Узнать цену на даты”.",
            "средняя",
            "высокий",
            "P1",
            "контент-менеджер/разработчик",
            evidence=f"Room signals: {', '.join(signals.get('hotel_room_matches', [])) or 'слабые или не найдены'}",
        ),
    ])

    if not signals.get("hotel_food_spa_matches"):
        issues.append(_issue(
            "Выделить ресторан, завтрак и SPA как отдельные причины выбора",
            "Ресторан, завтрак, SPA или дополнительные услуги не выглядят как самостоятельные аргументы бронирования.",
            "Дополнительные сервисы помогают повысить ценность номера и удержать гостя на официальном сайте.",
            "Добавить компактный блок с фото и CTA: “Посмотреть ресторан”, “Уточнить SPA”, “Узнать, что входит в проживание”.",
            "низкая",
            "средний",
            "P2",
            "контент-менеджер",
            evidence=f"Food/SPA signals: {', '.join(signals.get('hotel_food_spa_matches', [])) or 'не найдены'}",
        ))
    if not signals.get("hotel_location_matches"):
        issues.append(_issue(
            "Сделать локацию коммерческим аргументом",
            "Адрес и близость к важным точкам не раскрыты как причина выбрать отель.",
            "Для отеля локация часто продаёт не хуже цены: центр, аэропорт, бизнес-районы, достопримечательности, транспорт.",
            "Добавить блок “Рядом с отелем”: 4-6 точек, время в пути, карта, кнопка “Построить маршрут”.",
            "низкая",
            "средний",
            "P2",
            "контент-менеджер",
            evidence=f"Location signals: {', '.join(signals.get('hotel_location_matches', [])) or 'не найдены'}",
        ))
    if not signals.get("hotel_transport_matches"):
        issues.append(_issue(
            "Показать парковку, трансфер и удобство прибытия",
            "Для гостя важно заранее понять, как добраться до отеля и где оставить автомобиль.",
            "Трансфер, парковка и расстояния до аэропорта/центра снижают тревогу перед бронированием.",
            "Добавить короткий блок “Как добраться”: парковка, трансфер, расстояние до аэропорта/центра и кнопка построения маршрута.",
            "низкая",
            "средний",
            "P2",
            "контент-менеджер",
            evidence="Сигналы parking/transfer не обнаружены в собранных данных.",
        ))
    if not signals.get("hotel_faq_matches"):
        issues.append(_issue(
            "Добавить FAQ по заселению, отмене, оплате и документам",
            "На странице не обнаружены ответы на частые вопросы гостя перед бронированием.",
            "FAQ снимает сомнения перед выбором дат: документы, оплата, отмена, заезд/выезд, проживание с детьми.",
            "Добавить 5-7 вопросов под финальным CTA и связать их с бронированием номера.",
            "низкая",
            "средний",
            "P2",
            "контент-менеджер",
            evidence="FAQ/заселение/отмена/оплата/документы не обнаружены в собранных данных.",
        ))
    if parser.images_without_alt and len(issues) < 9:
        issues.append(_issue(
            "Описать ключевые фото номеров и инфраструктуры",
            f"Изображений без alt: {parser.images_without_alt} из {parser.images}.",
            "Для отеля фотографии продают номер, ресторан, SPA и конференц-залы. Описания помогают понять, что именно показано.",
            "Добавить alt только к важным фото: категория номера, ресторан, конференц-зал, фасад, локация.",
            "низкая",
            "низкий",
            "P3",
            "контент-менеджер/разработчик",
            evidence=f"Images: {parser.images}, without alt: {parser.images_without_alt}",
        ))
    while len(issues) < 8:
        weakest = min(scores, key=lambda item: int(item["score"]))
        title = f"Усилить направление: {weakest['area']}"
        if any(item["title"] == title for item in issues):
            break
        issues.append(_issue(
            title,
            weakest["problems"][0],
            "Это влияет на путь гостя от первого экрана до бронирования.",
            "Проверить этот блок вручную и внедрить правки из структуры отчёта.",
            "средняя",
            "средний",
            "P2",
            "маркетолог",
            evidence=f"Оценка направления: {weakest['score']}/100",
        ))
    return _dedupe_issues(issues)[:10]


def _quick_wins(parser: _PageParser, signals: dict[str, Any], context: dict[str, Any]) -> list[dict[str, str]]:
    if _is_hotel_context(context):
        return _hotel_quick_wins(signals)

    return [
        {"title": "Переписать H1 под результат", "action": _rewrite_h1(parser, context), "time": "15 минут"},
        {"title": "Заменить CTA", "action": f"Поставьте кнопку “{_cta_variants(context)[0]}” на первом экране.", "time": "10 минут"},
        {"title": "Добавить 3 факта доверия", "action": "Например: годы опыта, количество клиентов, кейс, сертификат или гарантию.", "time": "30 минут"},
        {"title": "Показать быстрый контакт", "action": "Добавьте телефон или WhatsApp рядом с основной кнопкой.", "time": "20 минут"},
        {"title": "Сократить первый экран", "action": "Оставьте один главный смысл, один подзаголовок и один основной CTA.", "time": "30-60 минут"},
        {"title": "Добавить описание страницы", "action": "Сформулируйте 140-160 символов: услуга, выгода, город/ниша и действие.", "time": "10 минут"},
    ]


def _hotel_quick_wins(signals: dict[str, Any]) -> list[dict[str, str]]:
    wins = [
        {"title": "Заменить главный CTA", "action": "Поставить на первый экран кнопку “Проверить свободные номера” или “Узнать цену на даты”.", "time": "10 минут"},
        {"title": "Добавить блок direct booking", "action": "Сформулировать 3 причины бронировать на официальном сайте: лучший тариф, бонус, бесплатная отмена или прямой контакт с отелем.", "time": "30 минут"},
        {"title": "Разделить аудитории", "action": "Добавить короткие карточки “Для отдыха”, “Для деловой поездки”, “Для конференций и мероприятий”.", "time": "45 минут"},
        {"title": "Усилить блок номеров", "action": "Для каждой категории показать фото, вместимость, что входит в стоимость и кнопку “Узнать цену на даты”.", "time": "60 минут"},
        {"title": "Добавить доверие рядом с CTA", "action": "Поставить рядом с кнопкой рейтинг, количество отзывов, локацию и быстрый контакт.", "time": "30 минут"},
        {"title": "Сделать локацию преимуществом", "action": "Показать, сколько минут до центра, аэропорта, бизнес-района или популярных точек Алматы.", "time": "30 минут"},
    ]
    if signals.get("hotel_direct_booking_matches"):
        wins[1] = {"title": "Сделать выгоду прямого бронирования заметнее", "action": "Вынести existing direct-booking выгоду в hero и повторить перед блоком номеров.", "time": "20 минут"}
    return wins


def _rewritten_copy(parser: _PageParser, context: dict[str, Any]) -> dict[str, Any]:
    if _is_hotel_context(context):
        return _hotel_rewritten_copy(context)

    return {
        "h1_variants": [
            _rewrite_h1(parser, context),
            f"{_capitalize(context['site_type'])} для тех, кому нужны {context['goal']} без лишней сложности",
            f"Поможем превратить сайт в понятный источник {context['goal']}",
        ],
        "subheadline": f"Покажите клиенту главное: что вы делаете, кому помогаете, почему вам можно доверять и какой шаг нужно сделать сейчас.",
        "cta_variants": _cta_variants(context),
        "hero_text": f"{_capitalize(context['site_type'])}: коротко объясните результат, добавьте 2-3 доказательства и предложите понятный следующий шаг — {context['goal']}.",
        "why_choose_us": [
            "Показываем понятный результат, а не абстрактные обещания.",
            "Объясняем процесс заранее, чтобы клиент понимал следующий шаг.",
            "Подкрепляем предложение фактами: кейсами, отзывами, цифрами и контактами.",
        ],
        "form_text": f"Оставьте контакты — мы уточним задачу и подскажем лучший следующий шаг для цели “{context['goal']}”.",
    }


def _hotel_rewritten_copy(context: dict[str, Any]) -> dict[str, Any]:
    region = f" в {context['region']}" if context.get("region") else ""
    return {
        "h1_variants": [
            f"Отель{region} для деловых поездок, отдыха и мероприятий",
            f"Забронируйте номер{region} на официальном сайте отеля",
            "Комфортное проживание, конференции и ресторан в одном отеле",
            f"Отель{region}: номера, конференц-залы и прямое бронирование",
            f"Номера{region} для отдыха и бизнеса с бронированием напрямую",
        ],
        "subheadline": "Проверьте свободные номера на нужные даты, сравните категории и забронируйте напрямую: без лишних шагов, с понятными условиями и быстрым контактом с отелем.",
        "subheadline_variants": [
            "Выберите даты, посмотрите доступные категории номеров и забронируйте на официальном сайте без перехода на агрегаторы.",
            "Для отдыха, командировки и мероприятий: номера, ресторан, конференц-залы и быстрый контакт с отелем.",
            "Покажите гостю цену на даты, условия проживания и преимущества бронирования напрямую в одном понятном сценарии.",
        ],
        "cta_variants": _cta_variants(context),
        "hero_text": "Покажите на первом экране: город/район, главный тип гостей, 2-3 причины выбрать отель, кнопку проверки дат и короткую выгоду бронирования напрямую.",
        "direct_booking_block": [
            "Лучшие условия при бронировании на официальном сайте.",
            "Прямая связь с отелем без посредников и лишних комиссий.",
            "Актуальные категории номеров, условия отмены и быстрый ответ по датам.",
        ],
        "business_guests_block": "Для командировок: удобная локация, документы для отчётности, быстрый Wi‑Fi, завтрак и возможность уточнить ранний заезд или поздний выезд.",
        "events_block": "Для мероприятий: покажите вместимость залов, форматы рассадки, оборудование, питание и отдельный CTA “Забронировать конференц-зал”.",
        "why_choose_us": [
            "Бронируя на официальном сайте, гость получает актуальные условия и прямую связь с отелем.",
            "Номера, ресторан, конференц-залы и дополнительные услуги собраны в одном понятном сценарии.",
            "Локация, реальные фото, отзывы и быстрый контакт помогают принять решение без ухода на агрегаторы.",
        ],
        "form_text": "Укажите даты проживания и количество гостей — мы покажем доступные номера и актуальную стоимость.",
    }


def _recommended_structure(context: dict[str, Any]) -> list[dict[str, str]]:
    if _is_hotel_context(context):
        return _hotel_recommended_structure(context)

    blocks = [
        ("Hero / оффер / CTA", "Сразу объяснить услугу, выгоду и следующий шаг."),
        ("Для кого", "Назвать аудитории и ситуации, где предложение особенно полезно."),
        ("Что получите", "Показать конкретный результат, а не только список услуг."),
        ("Как это работает", "Дать 3-5 шагов, чтобы снять тревогу перед заявкой."),
        ("Кейсы или примеры", "Подтвердить опыт фактами, цифрами или историями."),
        ("Доверие", "Отзывы, сертификаты, партнёры, команда, гарантии, контакты."),
        ("FAQ", "Ответить на возражения до формы заявки."),
        ("Финальный CTA", f"Повторить действие под цель: {context['goal']}."),
    ]
    if "магаз" in context["site_type"].lower():
        blocks.insert(3, ("Категории / популярные товары", "Сократить путь до выбора и покупки."))
    return [{"block": block, "purpose": purpose} for block, purpose in blocks]


def _hotel_recommended_structure(context: dict[str, Any]) -> list[dict[str, str]]:
    blocks = [
        ("Hero: отель + бронирование", "Сразу показать город/район, для кого отель, кнопку “Проверить свободные номера” и выгоду прямого бронирования."),
        ("Booking engine / проверка дат", "Дать быстрый ввод дат, гостей и категорий номеров или понятный переход к бронированию."),
        ("Почему бронировать на сайте выгоднее", "Показать лучший тариф, бонусы, бесплатную отмену, прямой контакт или другие преимущества без OTA-комиссии."),
        ("Номера и категории", "Фото, вместимость, что входит в цену, отличия категорий и CTA “Узнать цену на даты”."),
        ("Для кого этот отель", "Развести сценарии: туристы, бизнес-гости, семьи, мероприятия, конференции."),
        ("Локация и что рядом", "Карта, время до аэропорта/центра/деловых районов/достопримечательностей."),
        ("Конференц-залы и мероприятия", "Отдельный блок с вместимостью, форматами посадки и CTA “Забронировать конференц-зал”."),
        ("Ресторан / завтрак / SPA", "Показать дополнительные причины выбрать отель и повысить ценность проживания."),
        ("Отзывы, рейтинг и реальные фото", "Подтвердить доверие: рейтинг гостей, отзывы, фото номеров и инфраструктуры."),
        ("FAQ и финальный CTA", "Ответить на вопросы про заселение, отмену, парковку, документы, оплату и повторить бронирование."),
    ]
    return [{"block": block, "purpose": purpose} for block, purpose in blocks]


def _implementation_plan(top_issues: list[dict[str, str]], quick_wins: list[dict[str, str]]) -> list[dict[str, str]]:
    plan = []
    for item in top_issues[:8]:
        plan.append({
            "task": item["title"],
            "impact": item["effect"],
            "difficulty": item["difficulty"],
            "priority": item["priority"],
            "owner": item["owner"],
        })
    return plan


def _questions(context: dict[str, Any]) -> list[str]:
    if _is_hotel_context(context):
        return _hotel_questions(context)

    questions = [
        "Кто основная целевая аудитория страницы?",
        "Какое действие важнее всего: заявка, звонок, продажа, бронь или консультация?",
        "Какая услуга или продукт должны продаваться в первую очередь?",
        "Какие источники трафика ведут на эту страницу?",
        "Кого вы считаете главным конкурентом и чем хотите отличаться?",
    ]
    if context["audience"]:
        questions[0] = f"Правильно ли считать основной аудиторией: {context['audience']}?"
    if context["competitor"]:
        questions[-1] = f"Чем вы хотите отличаться от конкурента {context['competitor']}?"
    return questions[:5]


def _hotel_questions(context: dict[str, Any]) -> list[str]:
    questions = [
        "Какая главная аудитория страницы: туристы, бизнес-гости, семьи, мероприятия или все сразу?",
        "Есть ли реальная выгода бронировать напрямую на официальном сайте: тариф, бонус, отмена, ранний заезд?",
        "Какие категории номеров нужно продавать в первую очередь и что входит в стоимость?",
        "Какие сильные стороны локации важнее всего: центр, аэропорт, бизнес-район, достопримечательности?",
        "Нужно ли отдельно продвигать конференц-залы, ресторан, SPA или мероприятия?",
    ]
    if context.get("audience"):
        questions[0] = f"Правильно ли считать основной аудиторией отеля: {context['audience']}?"
    if context.get("competitor"):
        questions.append(f"Чем отель должен отличаться от конкурента {context['competitor']}: цена, локация, сервис, номера или мероприятия?")
    return questions[:6]


def _summary(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any]) -> str:
    if _is_hotel_context(context):
        return _hotel_summary(signals)

    if not parser.title and not parser.h1:
        return "Страница загружается, но базовая структура с title/H1 выглядит слабой: оффер нужно прояснить."
    if signals["has_form_or_button"] and signals["trust_matches"]:
        return "У страницы есть базовые элементы заявки и доверия, но их стоит усилить и выстроить в более понятный путь к конверсии."
    if word_count < 250:
        return "Страница выглядит слишком короткой для уверенной заявки: нужно усилить оффер, доверие, объяснение процесса и CTA."
    return "Страница доступна для анализа. Ниже — приоритеты по первому экрану, офферу, текстам, UX и конверсии."


def _hotel_summary(signals: dict[str, Any]) -> str:
    missing: list[str] = []
    if not signals.get("hotel_direct_booking_matches"):
        missing.append("выгоду прямого бронирования")
    if not signals.get("hotel_booking_matches"):
        missing.append("явный CTA бронирования")
    if not signals.get("hotel_room_matches"):
        missing.append("номера и категории")
    if not signals.get("hotel_business_matches"):
        missing.append("сценарии для бизнес-гостей и мероприятий")
    if not missing:
        return "Страница похожа на отельный сайт с базовыми сигналами бронирования, но её стоит усилить direct-booking аргументами, сегментами гостей и более явным путём к выбору дат."
    return f"Страница анализируется как отель. Главные зоны роста: {', '.join(missing[:4])}. Приоритет — увеличить прямые бронирования, а не просто улучшать общий текст сайта."


def _verdict(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any], scores: list[dict[str, Any]]) -> dict[str, Any]:
    if _is_hotel_context(context):
        weakest = sorted(scores, key=lambda item: item["score"])[:3]
        return {
            "summary": _hotel_summary(signals),
            "does_well": [
                "Страница открывается и даёт материал для анализа отельного сценария.",
                "Можно быстро усилить путь гостя от первого экрана до проверки дат и бронирования.",
            ],
            "main_risk": "Гость уйдёт сравнивать цену и условия на Booking/OTA, если сайт не объясняет выгоду прямого бронирования.",
            "fastest_win": "Самый быстрый выигрыш — заменить главный CTA на “Проверить свободные номера” и добавить рядом 3 причины бронировать напрямую.",
            "weakest_areas": [item["area"] for item in weakest],
        }

    weakest = sorted(scores, key=lambda item: item["score"])[:3]
    return {
        "summary": _summary(parser, word_count, signals, context),
        "does_well": [
            "Страница открывается и даёт материал для анализа.",
            "Есть базовая структура контента." if parser.h1 or parser.h2 else "Контент можно быстро пересобрать в понятную структуру.",
        ],
        "main_risk": f"Пользователь не увидит достаточно причин оставить {context['goal']} прямо сейчас.",
        "fastest_win": "Самый быстрый выигрыш — переписать первый экран: конкретный H1, короткий подзаголовок, один заметный CTA и 2-3 факта доверия.",
        "weakest_areas": [item["area"] for item in weakest],
    }


def _legacy_recommendations(top_issues: list[dict[str, str]]) -> list[dict[str, str]]:
    priority_map = {"P1": "high", "P2": "medium", "P3": "low"}
    return [
        {"area": item["title"], "priority": priority_map.get(item["priority"], "medium"), "recommendation": item["what_to_do"]}
        for item in top_issues[:6]
    ]


def _issue(title: str, problem: str, why: str, what: str, difficulty: str, effect: str, priority: str, owner: str, *, evidence: str = "") -> dict[str, str]:
    return {"title": title, "problem": problem, "why_it_matters": why, "what_to_do": what, "difficulty": difficulty, "effect": effect, "priority": priority, "owner": owner, "evidence": evidence}


def _dedupe_issues(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for item in items:
        key = _semantic_key(item.get("title", ""))
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _evidence(parser: _PageParser, text: str, audit_facts: dict[str, Any] | None = None) -> dict[str, Any]:
    snippets = [part for part in parser.text_parts if len(part) > 28][:6]
    facts = audit_facts or {}
    return {
        "title": parser.title,
        "h1": parser.h1[:3],
        "h2": parser.h2[:6],
        "h3": parser.h3[:6],
        "buttons": parser.button_texts[:6],
        "links_text": parser.link_texts[:8],
        "text_snippets": snippets,
        "contacts": {
            "phone_links": parser.phone_links,
            "email_links": parser.email_links,
            "whatsapp_links": parser.whatsapp_links,
        },
        "audit_engine": {
            "rendered_dom_used": bool(facts.get("engine", {}).get("rendered_dom_used")),
            "render_reason": facts.get("engine", {}).get("render_reason", ""),
            "screenshot": facts.get("screenshot", {"captured": False}),
            "first_screen_blocks": facts.get("first_screen_blocks", [])[:12],
            "first_screen_text": facts.get("first_screen_text", "")[:700],
            "cta_texts": facts.get("cta_texts", [])[:12],
            "forms": facts.get("forms", {}),
            "links": facts.get("links", {}),
            "images": facts.get("images", {}),
            "structured_data": facts.get("structured_data", {}),
            "accessibility": facts.get("accessibility", {}),
            "pagespeed": facts.get("pagespeed", {"enabled": False}),
        },
    }


def _score(base: int, *rules: tuple[bool, int]) -> int:
    value = base + sum(points for passed, points in rules if passed)
    return max(0, min(100, value))


def _score_explanation(score: int) -> str:
    if score >= 80:
        return "Сильная зона, достаточно точечных улучшений."
    if score >= 60:
        return "Работает, но есть заметные точки роста."
    if score >= 40:
        return "Средняя зона: может мешать заявкам."
    return "Слабая зона, лучше исправить в первую очередь."


def _rewrite_h1(parser: _PageParser, context: dict[str, Any]) -> str:
    if _is_hotel_context(context):
        region = f" в {context['region']}" if context.get("region") else ""
        return f"Отель{region} для комфортного проживания, деловых поездок и прямого бронирования"

    region = f" в {context['region']}" if context["region"] else ""
    return f"{_capitalize(context['site_type'])}{region}, который помогает получать {context['goal']} без лишних шагов"


def _cta_variants(context: dict[str, Any]) -> list[str]:
    if _is_hotel_context(context):
        return ["Проверить свободные номера", "Забронировать номер", "Узнать цену на даты", "Забронировать конференц-зал", "Посмотреть номера и цены"]

    goal = context["goal"].lower()
    if "звон" in goal:
        return ["Заказать звонок", "Обсудить задачу", "Получить консультацию"]
    if "прод" in goal:
        return ["Выбрать решение", "Получить предложение", "Рассчитать стоимость"]
    if "брон" in goal or "запис" in goal:
        return ["Записаться на удобное время", "Проверить свободное время", "Оставить заявку на запись"]
    return ["Получить консультацию", "Оставить заявку", "Получить аудит страницы"]


def _looks_generic(value: str) -> bool:
    lower = (value or "").lower()
    return not value or lower in {"главная", "услуги", "о компании"} or len(value) < 18


def _too_many_caps(value: str) -> bool:
    letters = [ch for ch in value if ch.isalpha()]
    if len(letters) < 8:
        return False
    return sum(1 for ch in letters if ch.isupper()) / len(letters) > 0.65


def _matches(text: str, variants: list[str]) -> list[str]:
    return [word for word in variants if word in text]


def _capitalize(value: str) -> str:
    return (value[:1].upper() + value[1:]) if value else "Сайт"


def _validate_public_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise SiteAnalysisError("Введите URL сайта.")
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SiteAnalysisError("Поддерживаются только публичные http/https URL.")
    if parsed.username or parsed.password:
        raise SiteAnalysisError("URL с логином и паролем не поддерживается.")
    _reject_private_host(parsed.hostname)
    return parsed.geturl()


def _reject_private_host(hostname: str) -> None:
    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SiteAnalysisError("Не удалось определить IP адрес сайта.") from exc
    for info in infos:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise SiteAnalysisError("Этот адрес нельзя анализировать. Для безопасности доступны только публичные сайты.")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _charset_from_content_type(content_type: str) -> str:
    match = re.search(r"charset=([\w.-]+)", content_type, flags=re.I)
    return match.group(1) if match else "utf-8"


def _error_result(url: str, message: str) -> dict[str, Any]:
    issue = _issue(
        "Проверить доступность страницы",
        "Не удалось открыть страницу для анализа.",
        "Без публично доступной HTML-страницы невозможно оценить оффер, CTA и структуру.",
        "Проверьте URL, доступность сайта и блокировки для внешних запросов.",
        "низкая",
        "высокий",
        "P1",
        "разработчик",
    )
    return {
        "status": "error",
        "url": url,
        "summary": "Не удалось выполнить анализ сайта.",
        "error": message,
        "verdict": {"summary": "Страница недоступна для анализа.", "main_risk": "Сайт не открывается публично.", "fastest_win": "Проверить URL и доступность HTML-страницы."},
        "scores": [],
        "scorecards": [],
        "top_issues": [issue],
        "quick_wins": [{"title": "Проверить URL", "action": "Откройте страницу в приватном окне и повторите анализ.", "time": "5 минут"}],
        "rewritten_copy": {},
        "recommended_structure": [],
        "implementation_plan": [],
        "priority_matrix": [],
        "questions": ["Открывается ли страница без авторизации?", "Не блокирует ли сайт внешние запросы?"],
        "priority_recommendations": _legacy_recommendations([issue]),
        "checks": {},
    }
