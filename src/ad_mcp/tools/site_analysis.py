from __future__ import annotations

import base64
import ipaddress
import io
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
MAX_SCREENSHOT_PREVIEW_BYTES = 140_000
PUBLIC_RESPONSE_HEADERS = {
    "cache-control",
    "content-security-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "permissions-policy",
    "referrer-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
}
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
    "book now",
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
    "посмотреть номера и цены",
]
GENERIC_SUBMIT_WORDS = {"отправить", "submit", "send", "ok", "далее"}
CTA_NOISE_WORDS = {"ru", "kz", "en", "cn", "главная", "вернуться назад", "назад", "стать участником"}
HOTEL_NAVIGATION_LINKS = {
    "номера",
    "rooms",
    "контакты",
    "contacts",
    "предложения",
    "offers",
    "смотреть еще",
    "смотреть ещё",
    "конференц-залы",
    "конференц залы",
    "ресторан",
    "ресторан salt",
    "выбор гостиницы",
    "посмотреть на карте",
    "о гостинице",
    "галерея",
}
CONTACT_CTA_KEYWORDS = ["позвонить", "call", "whatsapp", "написать", "связаться", "contact us", "связаться с отелем"]
SECONDARY_CTA_KEYWORDS = ["подробнее", "смотреть", "посмотреть", "узнать больше", "more", "learn more"]
LEAD_CTA_KEYWORDS = [
    "получить консультацию",
    "оставить заявку",
    "заказать звонок",
    "get consultation",
    "contact us",
    "request",
    "order",
]

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
    extracted_text = _extract_main_text(html)
    text = _clean_text(" ".join(part for part in [extracted_text, " ".join(parser.text_parts)] if part))
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
    ready_hero = _ready_hero(context)
    first_screen_review = _first_screen_review(parser, audit_facts or {}, signals, context, ready_hero)
    audit_overview = _audit_overview(parser, audit_facts or {}, context)
    one_day_plan = _one_day_plan(context, signals)
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
        "ready_hero": ready_hero,
        "first_screen_review": first_screen_review,
        "audit_overview": audit_overview,
        "one_day_plan": one_day_plan,
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
                "first_screen_booking_ctas": signals.get("first_screen_booking_ctas", []),
                "contact_ctas": signals.get("contact_ctas", []),
                "navigation_links": signals.get("navigation_links", []),
            },
            "niche_scores": signals.get("niche_scores", {}),
            "audit_engine": {
                "rendered_dom_used": bool((audit_facts or {}).get("engine", {}).get("rendered_dom_used")),
                "render_reason": (audit_facts or {}).get("engine", {}).get("render_reason", ""),
                "screenshot_captured": bool((audit_facts or {}).get("screenshot", {}).get("captured")),
                "mobile_screenshot_captured": bool((audit_facts or {}).get("screenshot", {}).get("mobile", {}).get("captured")),
                "first_screen_blocks": len((audit_facts or {}).get("first_screen_blocks", [])),
                "extraction_method": (audit_facts or {}).get("extraction_method", "html_parser"),
                "pagespeed": (audit_facts or {}).get("pagespeed", {"enabled": False}),
            },
            "accessibility_score": (audit_facts or {}).get("accessibility", {}).get("score"),
            "passive_security_score": (audit_facts or {}).get("security", {}).get("score"),
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
        response_headers=static_page.get("headers"),
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
        headers = {
            str(key).lower(): _clean_text(str(value))[:500]
            for key, value in response.headers.items()
            if str(key).lower() in PUBLIC_RESPONSE_HEADERS
        }
        raw = response.read(MAX_HTML_BYTES + 1)
    if "html" not in content_type.lower():
        raise SiteAnalysisError("Ссылка открылась, но это не HTML-страница.")
    return {
        "html": raw[:MAX_HTML_BYTES].decode(_charset_from_content_type(content_type), errors="replace"),
        "final_url": final_url,
        "status": status,
        "content_type": content_type,
        "headers": headers,
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
            dom_audit = _rendered_dom_facts(page)
            performance = _rendered_performance_facts(page)
            screenshot = page.screenshot(full_page=False, type="png", timeout=5000)
            html = page.content()[:MAX_HTML_BYTES]
            mobile_screenshot = b""
            mobile_dom: dict[str, Any] = {}
            mobile_page = None
            try:
                mobile_page = browser.new_page(
                    viewport={"width": 390, "height": 844},
                    device_scale_factor=1,
                    is_mobile=True,
                    has_touch=True,
                    java_script_enabled=True,
                )
                mobile_page.route("**/*", _route_guard)
                mobile_page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT_SECONDS * 1000)
                try:
                    mobile_page.wait_for_load_state("networkidle", timeout=2000)
                except PlaywrightError:
                    pass
                mobile_dom = _rendered_dom_facts(mobile_page)
                mobile_screenshot = mobile_page.screenshot(full_page=False, type="png", timeout=5000)
            except Exception as exc:
                mobile_dom = {"available": False, "reason": f"mobile_render_failed:{type(exc).__name__}"}
            finally:
                if mobile_page is not None:
                    mobile_page.close()
            browser.close()
        screenshot_meta = _screenshot_metadata(screenshot)
        mobile_meta = _screenshot_metadata(mobile_screenshot)
        return {
            "html": html,
            "final_url": final_url,
            "status": int(response.status if response else 200),
            "truncated": len(html) >= MAX_HTML_BYTES,
            "screenshot": screenshot_meta | {
                "captured": True,
                "mime": "image/png",
                "bytes": len(screenshot),
                "sha256": hashlib.sha256(screenshot).hexdigest(),
                "mobile": mobile_meta
                | {
                    "captured": bool(mobile_screenshot),
                    "mime": "image/png" if mobile_screenshot else "",
                    "bytes": len(mobile_screenshot),
                    "sha256": hashlib.sha256(mobile_screenshot).hexdigest() if mobile_screenshot else "",
                },
            },
            "facts": {
                "first_screen_blocks": first_screen,
                "dom_audit": dom_audit,
                "mobile_dom_audit": mobile_dom,
                "performance": performance,
            },
        }
    except Exception as exc:
        return {"reason": f"render_failed:{type(exc).__name__}"}


def _rendered_dom_facts(page: Any) -> dict[str, Any]:
    return page.evaluate(
        r"""
        () => {
          const visible = (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
          };
          const nameOf = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
          const sample = (items) => items.slice(0, 6).map((el) => nameOf(el) || `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`);
          const interactive = Array.from(document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"]')).filter(visible);
          const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')).filter(visible);
          const links = Array.from(document.querySelectorAll('a[href]')).filter(visible);
          const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select')).filter(visible);
          const labelled = (el) => {
            if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true;
            if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
            return Boolean(el.closest('label'));
          };
          const buttonsWithoutName = buttons.filter((el) => !nameOf(el));
          const linksWithoutName = links.filter((el) => !nameOf(el) && !el.querySelector('img[alt]:not([alt=""])'));
          const fieldsWithoutLabel = fields.filter((el) => !labelled(el));
          const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id).filter(Boolean);
          const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
          const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible);
          const headingJumps = [];
          let previous = 0;
          headings.forEach((el) => {
            const level = Number(el.tagName.slice(1));
            if (previous && level > previous + 1) headingJumps.push(`${el.tagName}: ${nameOf(el)}`);
            previous = level;
          });
          const overflow = Array.from(document.body.querySelectorAll('*')).filter((el) => {
            if (!visible(el)) return false;
            const rect = el.getBoundingClientRect();
            return rect.right > window.innerWidth + 2 || rect.left < -2;
          });
          const smallTargets = interactive.filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width < 44 || rect.height < 44;
          });
          const smallText = Array.from(document.querySelectorAll('p,li,a,button,label,span')).filter((el) => visible(el) && parseFloat(getComputedStyle(el).fontSize || '16') < 12);
          const aboveFold = interactive.filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.top >= -4 && rect.top < window.innerHeight && nameOf(el);
          });
          return {
            available: true,
            viewport: {width: window.innerWidth, height: window.innerHeight},
            html_lang: document.documentElement.lang || '',
            dom_nodes: document.querySelectorAll('*').length,
            forms_count: document.forms.length,
            buttons_without_name: buttonsWithoutName.length,
            buttons_without_name_samples: sample(buttonsWithoutName),
            links_without_name: linksWithoutName.length,
            links_without_name_samples: sample(linksWithoutName),
            fields_without_label: fieldsWithoutLabel.length,
            fields_without_label_samples: sample(fieldsWithoutLabel),
            duplicate_ids: duplicateIds.length,
            duplicate_id_samples: duplicateIds.slice(0, 6),
            heading_order_issues: headingJumps.length,
            heading_order_samples: headingJumps.slice(0, 6),
            horizontal_overflow_count: overflow.length,
            horizontal_overflow_samples: sample(overflow),
            small_tap_targets: smallTargets.length,
            small_tap_target_samples: sample(smallTargets),
            small_text_elements: smallText.length,
            main_landmark_present: Boolean(document.querySelector('main,[role="main"]')),
            navigation_landmark_present: Boolean(document.querySelector('nav,[role="navigation"]')),
            cta_above_fold: sample(aboveFold),
          };
        }
        """
    )


def _rendered_performance_facts(page: Any) -> dict[str, Any]:
    return page.evaluate(
        """
        () => {
          const navigation = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource');
          const transfer = resources.reduce((sum, item) => sum + Number(item.transferSize || 0), 0);
          return {
            available: true,
            resource_count: resources.length,
            transfer_kb: Math.round(transfer / 1024),
            dom_nodes: document.querySelectorAll('*').length,
            dom_content_loaded_ms: navigation ? Math.round(navigation.domContentLoadedEventEnd) : 0,
            load_event_ms: navigation ? Math.round(navigation.loadEventEnd) : 0,
            response_ms: navigation ? Math.round(navigation.responseEnd) : 0,
          };
        }
        """
    )


def _extract_audit_facts(
    html: str,
    url: str,
    *,
    rendered_facts: dict[str, Any] | None = None,
    screenshot: dict[str, Any] | None = None,
    response_headers: dict[str, Any] | None = None,
    engine_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rendered_facts = rendered_facts or {}
    parser = _PageParser()
    parser.feed(html)
    soup_facts = _extract_with_beautifulsoup(html)
    extracted_text = _extract_main_text(html)
    text = _clean_text(" ".join(part for part in [extracted_text, " ".join(parser.text_parts)] if part))
    links = _extract_links(html, url)
    structured = _extract_structured_data(html)
    first_screen_blocks = _dedupe_blocks(rendered_facts.get("first_screen_blocks") or _fallback_first_screen_blocks(parser))
    cta_candidates = _extract_cta_candidates(html, first_screen_blocks)
    cta_groups = _group_cta_candidates(cta_candidates)
    ctas = (
        cta_groups.get("booking_cta", [])
        + cta_groups.get("contact_cta", [])
        + cta_groups.get("secondary_cta", [])
    )[:MAX_FACT_ITEMS]
    images = _extract_images(html)
    document = _document_signals(html)
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
        "cta_groups": cta_groups,
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
        "document": document,
        "main_text": {"available": bool(extracted_text), "chars": len(extracted_text)},
        "word_count": len(re.findall(r"[A-Za-zА-Яа-яЁё0-9]{3,}", text)),
        "first_screen_blocks": first_screen_blocks[:FIRST_SCREEN_LIMIT],
        "first_screen_text": _clean_text(" ".join(item.get("text", "") for item in first_screen_blocks))[:1500],
        "screenshot": screenshot or {"captured": False},
        "accessibility": _accessibility_signals(
            parser,
            images,
            static=document.get("accessibility", {}),
            desktop=rendered_facts.get("dom_audit", {}),
            mobile=rendered_facts.get("mobile_dom_audit", {}),
        ),
        "security": _security_header_signals(response_headers or {}, url),
        "performance": rendered_facts.get("performance", {"available": False, "reason": "rendered_metrics_unavailable"}),
        "mobile_layout": rendered_facts.get("mobile_dom_audit", {"available": False, "reason": "mobile_render_unavailable"}),
        "pagespeed": _pagespeed_signals(url),
    }
    return facts


def _screenshot_metadata(content: bytes) -> dict[str, Any]:
    if not content:
        return {"visual_analysis": {"available": False, "reason": "empty_screenshot"}}
    try:
        from PIL import Image, ImageStat
    except Exception:
        return {"visual_analysis": {"available": False, "reason": "pillow_not_installed"}}
    try:
        with Image.open(io.BytesIO(content)) as image:
            image = image.convert("RGB")
            width, height = image.size
            sample = image.resize((max(1, min(180, width)), max(1, min(120, height))))
            stat = ImageStat.Stat(sample)
            r, g, b = [float(value) for value in stat.mean[:3]]
            luma = (0.2126 * r + 0.7152 * g + 0.0722 * b)
            pixels = list(sample.getdata())
            total = max(1, len(pixels))
            dark_share = sum(1 for pr, pg, pb in pixels if (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) < 55) / total
            light_share = sum(1 for pr, pg, pb in pixels if (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) > 220) / total
            colorfulness = round((abs(r - g) + abs(g - b) + abs(b - r)) / 3, 1)
            hero_height = max(1, round(height * 0.62))
            preview = image.copy()
            preview.thumbnail((960, 960))
            preview_buffer = io.BytesIO()
            preview.save(preview_buffer, format="JPEG", quality=68, optimize=True)
            preview_bytes = preview_buffer.getvalue()
            if len(preview_bytes) > MAX_SCREENSHOT_PREVIEW_BYTES:
                preview_buffer = io.BytesIO()
                preview.save(preview_buffer, format="JPEG", quality=45, optimize=True)
                preview_bytes = preview_buffer.getvalue()
            preview_data_url = ""
            if len(preview_bytes) <= MAX_SCREENSHOT_PREVIEW_BYTES:
                preview_data_url = "data:image/jpeg;base64," + base64.b64encode(preview_bytes).decode("ascii")
            return {
                "width": width,
                "height": height,
                "viewport": {"width": width, "height": height},
                "hero_crop": {"x": 0, "y": 0, "width": width, "height": hero_height},
                "preview_data_url": preview_data_url,
                "visual_analysis": {
                    "available": True,
                    "average_luma": round(luma, 1),
                    "dark_share": round(dark_share, 3),
                    "light_share": round(light_share, 3),
                    "colorfulness": colorfulness,
                    "theme_guess": "dark" if dark_share > 0.45 else "light" if light_share > 0.45 else "mixed",
                },
            }
    except Exception as exc:
        return {"visual_analysis": {"available": False, "reason": f"pillow_failed:{type(exc).__name__}"}}


def _group_cta_candidates(candidates: list[dict[str, Any]]) -> dict[str, list[str]]:
    groups = {
        "booking_cta": [],
        "contact_cta": [],
        "form_submit": [],
        "secondary_cta": [],
        "informational_link": [],
        "navigation_link": [],
    }
    for item in candidates:
        category = str(item.get("category") or "informational_link")
        groups.setdefault(category, [])
        text = _clean_text(str(item.get("text", "")))
        if text:
            groups[category].append(text)
    return {key: _clean_cta_list(value) if key in {"booking_cta", "contact_cta", "form_submit", "secondary_cta"} else _unique(value)[:8] for key, value in groups.items()}


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


def _extract_main_text(html: str) -> str:
    try:
        import trafilatura
    except Exception:
        return ""
    try:
        return _clean_text(trafilatura.extract(html, include_comments=False, include_tables=False) or "")[:12_000]
    except Exception:
        return ""


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
    derived_from_href = not text and bool(href)
    if not text and href:
        text = _text_from_href(href)
    lowered_text = text.lower()
    haystack = f"{text} {href}".lower()
    cta_category = _classify_cta(text, href, source)
    booking_related = cta_category == "booking_cta"
    if derived_from_href and not booking_related:
        return
    if lowered_text in CTA_NOISE_WORDS:
        return
    if _looks_like_url_noise(text) and not booking_related:
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
            "category": cta_category,
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
            _cta_category_priority(str(value.get("category", ""))),
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


def _classify_cta(text: str, href: str, source: str) -> str:
    lowered_text = text.lower().strip()
    haystack = f"{lowered_text} {href.lower()}".strip()
    href_lower = href.lower()
    if any(keyword in haystack for keyword in BOOKING_CTA_STRONG_KEYWORDS):
        return "booking_cta"
    if href_lower.startswith(("tel:", "mailto:")) or "wa.me" in href_lower or "whatsapp" in haystack:
        return "contact_cta"
    if any(keyword in haystack for keyword in LEAD_CTA_KEYWORDS):
        return "secondary_cta"
    if any(keyword in haystack for keyword in CONTACT_CTA_KEYWORDS):
        if lowered_text not in {"контакты", "contacts"}:
            return "contact_cta"
    if lowered_text in GENERIC_SUBMIT_WORDS or source == "input":
        return "form_submit"
    if lowered_text in HOTEL_NAVIGATION_LINKS:
        return "navigation_link"
    if any(keyword in lowered_text for keyword in SECONDARY_CTA_KEYWORDS):
        return "secondary_cta"
    if href:
        return "informational_link"
    return "informational_link"


def _cta_category_priority(category: str) -> int:
    order = {
        "booking_cta": 0,
        "contact_cta": 1,
        "form_submit": 2,
        "secondary_cta": 3,
        "informational_link": 4,
        "navigation_link": 5,
    }
    return order.get(category, 6)


def _extract_attr_values(html: str, attr: str) -> list[str]:
    return re.findall(rf"\b{re.escape(attr)}=[\"']([^\"']+)[\"']", html, flags=re.I)


def _text_from_href(href: str) -> str:
    value = re.sub(r"[_/#?=&.-]+", " ", href)
    value = _clean_text(value)
    return value[-70:] if len(value) > 70 else value


def _looks_like_url_noise(text: str) -> bool:
    lowered = text.lower()
    url_tokens = ("http", "www", ".com", ".kz", ".ru", "facebook", "instagram", "youtube", "t.me", "wa.me")
    if any(token in lowered for token in url_tokens):
        return True
    parts = lowered.split()
    return len(parts) >= 3 and parts[0] in {"ru", "en", "kz", "kk", "cn"}


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


def _document_signals(html: str) -> dict[str, Any]:
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return _document_signals_fallback(html)
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")

    def _meta(*, name: str = "", prop: str = "") -> str:
        attrs: dict[str, Any] = {}
        if name:
            attrs["name"] = re.compile(rf"^{re.escape(name)}$", re.I)
        if prop:
            attrs["property"] = re.compile(rf"^{re.escape(prop)}$", re.I)
        node = soup.find("meta", attrs=attrs)
        return _clean_text(str(node.get("content", ""))) if node else ""

    fields = [node for node in soup.select("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea, select")]
    field_labels = {str(node.get("for", "")) for node in soup.find_all("label") if node.get("for")}
    fields_without_label = 0
    for field in fields:
        labelled = bool(field.get("aria-label") or field.get("aria-labelledby") or field.get("title"))
        labelled = labelled or bool(field.get("id") and str(field.get("id")) in field_labels)
        labelled = labelled or field.find_parent("label") is not None
        if not labelled:
            fields_without_label += 1
    buttons = soup.select("button, [role='button'], input[type='button'], input[type='submit']")
    buttons_without_name = sum(
        1
        for node in buttons
        if not _clean_text(node.get_text(" ") or str(node.get("value", "")) or str(node.get("aria-label", "")) or str(node.get("title", "")))
    )
    links_without_name = sum(
        1
        for node in soup.select("a[href]")
        if not _clean_text(node.get_text(" ") or str(node.get("aria-label", "")) or str(node.get("title", "")))
        and not node.select_one("img[alt]:not([alt=''])")
    )
    ids = [str(node.get("id")) for node in soup.select("[id]") if node.get("id")]
    duplicate_ids = len({value for value in ids if ids.count(value) > 1})
    heading_order_issues = 0
    previous_level = 0
    for heading in soup.select("h1,h2,h3,h4,h5,h6"):
        level = int(heading.name[1])
        if previous_level and level > previous_level + 1:
            heading_order_issues += 1
        previous_level = level
    paragraphs = [_clean_text(node.get_text(" ")) for node in soup.find_all("p")]
    canonical_node = soup.find("link", attrs={"rel": re.compile("canonical", re.I)})
    return {
        "available": True,
        "accessibility": {
            "html_lang": _clean_text(str(soup.html.get("lang", ""))) if soup.html else "",
            "fields_without_label": fields_without_label,
            "buttons_without_name": buttons_without_name,
            "links_without_name": links_without_name,
            "duplicate_ids": duplicate_ids,
            "heading_order_issues": heading_order_issues,
            "main_landmark_present": bool(soup.select_one("main, [role='main']")),
            "navigation_landmark_present": bool(soup.select_one("nav, [role='navigation']")),
        },
        "seo": {
            "canonical_url": _clean_text(str(canonical_node.get("href", ""))) if canonical_node else "",
            "robots": _meta(name="robots"),
            "og_title": bool(_meta(prop="og:title")),
            "og_description": bool(_meta(prop="og:description")),
            "og_image": bool(_meta(prop="og:image")),
            "twitter_card": bool(_meta(name="twitter:card")),
            "hreflang_count": len(soup.select("link[hreflang]")),
        },
        "content": {
            "paragraphs": len(paragraphs),
            "long_paragraphs": sum(1 for value in paragraphs if len(value) > 320),
            "lists": len(soup.find_all(["ul", "ol"])),
            "tables": len(soup.find_all("table")),
        },
    }


def _document_signals_fallback(html: str) -> dict[str, Any]:
    lang_match = re.search(r"<html\b[^>]*\blang=[\"']([^\"']+)[\"']", html, flags=re.I)
    field_tags = re.findall(r"<(?:input|textarea|select)\b([^>]*)>", html, flags=re.I)
    label_targets = set(re.findall(r"<label\b[^>]*\bfor=[\"']([^\"']+)[\"']", html, flags=re.I))
    fields_without_label = 0
    for attrs in field_tags:
        if re.search(r"\btype=[\"'](?:hidden|submit|button)[\"']", attrs, flags=re.I):
            continue
        field_id = re.search(r"\bid=[\"']([^\"']+)[\"']", attrs, flags=re.I)
        has_name = re.search(r"\b(?:aria-label|aria-labelledby|title)=[\"'][^\"']+[\"']", attrs, flags=re.I)
        if not has_name and not (field_id and field_id.group(1) in label_targets):
            fields_without_label += 1
    ids = re.findall(r"\bid=[\"']([^\"']+)[\"']", html, flags=re.I)
    headings = [int(level) for level in re.findall(r"<h([1-6])\b", html, flags=re.I)]
    heading_order_issues = sum(1 for previous, current in zip(headings, headings[1:]) if current > previous + 1)
    paragraphs = [_clean_text(re.sub(r"<[^>]+>", " ", value)) for value in re.findall(r"<p\b[^>]*>(.*?)</p>", html, flags=re.I | re.S)]
    canonical = re.search(r"<link\b[^>]*\brel=[\"'][^\"']*canonical[^\"']*[\"'][^>]*\bhref=[\"']([^\"']+)[\"']", html, flags=re.I)
    return {
        "available": True,
        "source": "html_parser_fallback",
        "accessibility": {
            "html_lang": _clean_text(lang_match.group(1)) if lang_match else "",
            "fields_without_label": fields_without_label,
            "buttons_without_name": 0,
            "links_without_name": 0,
            "duplicate_ids": len({value for value in ids if ids.count(value) > 1}),
            "heading_order_issues": heading_order_issues,
            "main_landmark_present": bool(re.search(r"<(?:main\b|[^>]+\brole=[\"']main[\"'])", html, flags=re.I)),
            "navigation_landmark_present": bool(re.search(r"<(?:nav\b|[^>]+\brole=[\"']navigation[\"'])", html, flags=re.I)),
        },
        "seo": {
            "canonical_url": _clean_text(canonical.group(1)) if canonical else "",
            "robots": "",
            "og_title": bool(re.search(r"property=[\"']og:title[\"']", html, flags=re.I)),
            "og_description": bool(re.search(r"property=[\"']og:description[\"']", html, flags=re.I)),
            "og_image": bool(re.search(r"property=[\"']og:image[\"']", html, flags=re.I)),
            "twitter_card": bool(re.search(r"name=[\"']twitter:card[\"']", html, flags=re.I)),
            "hreflang_count": len(re.findall(r"\bhreflang=", html, flags=re.I)),
        },
        "content": {
            "paragraphs": len(paragraphs),
            "long_paragraphs": sum(1 for value in paragraphs if len(value) > 320),
            "lists": len(re.findall(r"<(?:ul|ol)\b", html, flags=re.I)),
            "tables": len(re.findall(r"<table\b", html, flags=re.I)),
        },
    }


def _accessibility_signals(
    parser: _PageParser,
    images: dict[str, Any],
    *,
    static: dict[str, Any] | None = None,
    desktop: dict[str, Any] | None = None,
    mobile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    static = static or {}
    desktop = desktop or {}
    mobile = mobile or {}

    def _metric(name: str, fallback: Any = 0) -> Any:
        value = desktop.get(name)
        if value not in {None, ""}:
            return value
        return static.get(name, fallback)

    result = {
        "images_without_alt": int(images.get("without_alt", parser.images_without_alt) or 0),
        "empty_buttons": int(_metric("buttons_without_name", max(0, parser.buttons - len(parser.button_texts))) or 0),
        "links_without_name": int(_metric("links_without_name", 0) or 0),
        "fields_without_label": int(_metric("fields_without_label", 0) or 0),
        "duplicate_ids": int(_metric("duplicate_ids", 0) or 0),
        "heading_order_issues": int(_metric("heading_order_issues", 0) or 0),
        "html_lang": _clean_text(str(_metric("html_lang", ""))),
        "main_landmark_present": bool(_metric("main_landmark_present", False)),
        "navigation_landmark_present": bool(_metric("navigation_landmark_present", False)),
        "horizontal_overflow_desktop": int(desktop.get("horizontal_overflow_count", 0) or 0),
        "horizontal_overflow_mobile": int(mobile.get("horizontal_overflow_count", 0) or 0),
        "small_tap_targets_mobile": int(mobile.get("small_tap_targets", 0) or 0),
        "small_text_elements_mobile": int(mobile.get("small_text_elements", 0) or 0),
        "forms_without_visible_fields": parser.forms > 0 and parser.inputs == 0,
        "source": "rendered_dom" if desktop.get("available") else "static_html",
    }
    penalty = min(24, result["images_without_alt"] * 4)
    penalty += min(20, result["fields_without_label"] * 8)
    penalty += min(15, result["empty_buttons"] * 7)
    penalty += min(10, result["links_without_name"] * 4)
    penalty += min(10, result["heading_order_issues"] * 5)
    penalty += 8 if not result["html_lang"] else 0
    penalty += 8 if result["horizontal_overflow_mobile"] else 0
    penalty += min(10, result["small_tap_targets_mobile"] // 3)
    result["score"] = max(0, 100 - penalty)
    result["note"] = "Автоматическая проверка доступности по HTML и rendered DOM; не заменяет ручное WCAG-тестирование с клавиатурой и screen reader."
    return result


def _security_header_signals(headers: dict[str, Any], url: str) -> dict[str, Any]:
    normalized = {str(key).lower(): _clean_text(str(value))[:240] for key, value in headers.items()}
    csp = normalized.get("content-security-policy", "")
    is_https = urlparse(url).scheme == "https"
    checks: list[dict[str, str]] = []

    def _add(key: str, title: str, passed: bool, action: str, *, evidence: str = "", weight: int = 10) -> int:
        checks.append(
            {
                "key": key,
                "title": title,
                "status": "pass" if passed else "warn",
                "evidence": evidence or ("настроено" if passed else "заголовок не обнаружен"),
                "action": "Контроль настроен." if passed else action,
            }
        )
        return weight if passed else 0

    score = 0
    score += _add("https", "HTTPS transport", is_https, "Переведите страницу и все редиректы на HTTPS.", evidence="HTTPS" if is_https else "страница открыта по HTTP", weight=15)
    score += _add("csp", "Content Security Policy", bool(csp), "Добавьте CSP и начните с report-only режима.", evidence=csp, weight=25)
    score += _add(
        "hsts",
        "HTTPS Strict Transport Security",
        is_https and bool(normalized.get("strict-transport-security")),
        "Для HTTPS добавьте HSTS после проверки всех поддоменов.",
        evidence=normalized.get("strict-transport-security", ""),
        weight=15,
    )
    frame_protection = bool(normalized.get("x-frame-options")) or "frame-ancestors" in csp.lower()
    score += _add("frame", "Защита от clickjacking", frame_protection, "Добавьте frame-ancestors в CSP или X-Frame-Options.", evidence=normalized.get("x-frame-options", "") or ("CSP frame-ancestors" if frame_protection else ""), weight=15)
    score += _add("nosniff", "MIME sniffing protection", normalized.get("x-content-type-options", "").lower() == "nosniff", "Добавьте X-Content-Type-Options: nosniff.", evidence=normalized.get("x-content-type-options", ""), weight=10)
    score += _add("referrer", "Referrer Policy", bool(normalized.get("referrer-policy")), "Добавьте строгую Referrer-Policy.", evidence=normalized.get("referrer-policy", ""), weight=10)
    score += _add("permissions", "Permissions Policy", bool(normalized.get("permissions-policy")), "Ограничьте неиспользуемые browser APIs через Permissions-Policy.", evidence=normalized.get("permissions-policy", ""), weight=5)
    score += _add("cross_origin", "Cross-origin isolation policy", bool(normalized.get("cross-origin-opener-policy") or normalized.get("cross-origin-resource-policy")), "Оцените COOP/CORP для чувствительных интерфейсов.", evidence=normalized.get("cross-origin-opener-policy", "") or normalized.get("cross-origin-resource-policy", ""), weight=5)
    return {
        "mode": "passive_response_headers",
        "score": min(100, score),
        "checks": checks,
        "headers_present": sorted(normalized),
        "note": "Пассивная проверка публичных HTTP-заголовков. Она не является pentest и не проверяет сервер на эксплуатацию уязвимостей.",
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


def _audit_overview(parser: _PageParser, facts: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    screenshot = facts.get("screenshot", {}) if isinstance(facts.get("screenshot"), dict) else {}
    mobile_screenshot = screenshot.get("mobile", {}) if isinstance(screenshot.get("mobile"), dict) else {}
    accessibility = facts.get("accessibility", {}) if isinstance(facts.get("accessibility"), dict) else {}
    security = facts.get("security", {}) if isinstance(facts.get("security"), dict) else {}
    performance = facts.get("performance", {}) if isinstance(facts.get("performance"), dict) else {}
    document = facts.get("document", {}) if isinstance(facts.get("document"), dict) else {}
    seo = document.get("seo", {}) if isinstance(document.get("seo"), dict) else {}

    sources = ["HTML страницы"]
    confidence = 20
    if facts.get("engine", {}).get("rendered_dom_used"):
        sources.append("rendered DOM")
        confidence += 25
    if screenshot.get("captured"):
        sources.append("desktop screenshot")
        confidence += 20
    if mobile_screenshot.get("captured"):
        sources.append("mobile screenshot")
        confidence += 15
    if facts.get("main_text", {}).get("available"):
        sources.append("основной текст страницы")
        confidence += 10
    if facts.get("pagespeed", {}).get("enabled") and not facts.get("pagespeed", {}).get("error"):
        sources.append("PageSpeed API")
        confidence += 10
    confidence = min(100, confidence)

    def _label(score: int) -> str:
        if score >= 80:
            return "сильный"
        if score >= 60:
            return "требует внимания"
        return "риск"

    def _check(title: str, passed: bool, evidence: str, action: str, *, severity: str = "medium") -> dict[str, str]:
        return {
            "title": title,
            "status": "pass" if passed else ("fail" if severity == "high" else "warn"),
            "evidence": evidence,
            "action": "Проверка пройдена." if passed else action,
            "severity": "ok" if passed else severity,
        }

    accessibility_score = int(accessibility.get("score", 0) or 0)
    accessibility_checks = [
        _check("Alt-тексты изображений", int(accessibility.get("images_without_alt", 0) or 0) == 0, f"Без alt: {int(accessibility.get('images_without_alt', 0) or 0)}", "Добавьте содержательные alt для информативных изображений.", severity="medium"),
        _check("Подписи полей", int(accessibility.get("fields_without_label", 0) or 0) == 0, f"Полей без label: {int(accessibility.get('fields_without_label', 0) or 0)}", "Свяжите label и field через for/id или aria-label.", severity="high"),
        _check("Доступные имена кнопок", int(accessibility.get("empty_buttons", 0) or 0) == 0, f"Кнопок без имени: {int(accessibility.get('empty_buttons', 0) or 0)}", "Добавьте видимый текст или aria-label.", severity="high"),
        _check("Язык документа", bool(accessibility.get("html_lang")), f"lang: {accessibility.get('html_lang') or 'не задан'}", "Укажите lang на элементе html.", severity="medium"),
        _check("Мобильный overflow", int(accessibility.get("horizontal_overflow_mobile", 0) or 0) == 0, f"Элементов за viewport: {int(accessibility.get('horizontal_overflow_mobile', 0) or 0)}", "Исправьте горизонтальный скролл и ширины элементов.", severity="high"),
        _check("Размер интерактивных зон", int(accessibility.get("small_tap_targets_mobile", 0) or 0) == 0, f"Маленьких touch targets: {int(accessibility.get('small_tap_targets_mobile', 0) or 0)}", "Увеличьте кликабельные зоны примерно до 44x44 px.", severity="medium"),
    ]

    technical_rules = [
        ("Title", bool(parser.title), parser.title or "не найден", "Добавьте уникальный title."),
        ("Meta description", bool(parser.meta_description), parser.meta_description or "не найдена", "Добавьте описание страницы."),
        ("Один главный H1", len(parser.h1) == 1, f"H1: {len(parser.h1)}", "Оставьте один содержательный H1."),
        ("Mobile viewport", parser.viewport, "настроен" if parser.viewport else "не найден", "Добавьте viewport meta."),
        ("Canonical", parser.canonical, seo.get("canonical_url") or "не найден", "Добавьте canonical URL."),
        ("Structured data", parser.structured_data, ", ".join(facts.get("structured_data", {}).get("types", [])) or "не обнаружены", "Добавьте релевантную schema.org-разметку после проверки контента."),
        ("Open Graph", bool(seo.get("og_title") and seo.get("og_description") and seo.get("og_image")), "title/description/image" if seo.get("og_title") and seo.get("og_description") and seo.get("og_image") else "набор неполный", "Заполните og:title, og:description и og:image."),
    ]
    technical_checks = [_check(title, passed, str(evidence), action, severity="medium") for title, passed, evidence, action in technical_rules]
    technical_score = round(sum(1 for _, passed, _, _ in technical_rules if passed) / max(1, len(technical_rules)) * 100)

    performance_checks: list[dict[str, str]] = []
    if performance.get("available"):
        resource_count = int(performance.get("resource_count", 0) or 0)
        transfer_kb = int(performance.get("transfer_kb", 0) or 0)
        dom_nodes = int(performance.get("dom_nodes", 0) or 0)
        load_ms = int(performance.get("load_event_ms", 0) or 0)
        performance_checks = [
            _check("Количество ресурсов", resource_count <= 120, str(resource_count), "Сократите сторонние скрипты и объедините некритичные ресурсы."),
            _check("Переданный объём", transfer_kb == 0 or transfer_kb <= 3500, f"{transfer_kb} КБ" if transfer_kb else "браузер не раскрыл transfer size", "Оптимизируйте изображения, шрифты и JavaScript."),
            _check("Размер DOM", dom_nodes <= 1800, str(dom_nodes), "Упростите глубоко вложенную и повторяющуюся разметку."),
            _check("Load event", load_ms == 0 or load_ms <= 4000, f"{load_ms} мс" if load_ms else "нет стабильного значения", "Отложите некритичные ресурсы и сократите блокирующий код."),
        ]
        performance_score = round(sum(1 for item in performance_checks if item["status"] == "pass") / len(performance_checks) * 100)
    else:
        performance_score = 0
        performance_checks = [{"title": "Browser performance", "status": "unknown", "evidence": "rendered metrics недоступны", "action": "Повторите полный анализ с Playwright.", "severity": "unknown"}]

    security_checks = security.get("checks", []) if isinstance(security.get("checks"), list) else []
    security_score = int(security.get("score", 0) or 0)
    pillars = [
        {"id": "accessibility", "title": "Доступность и mobile UX", "score": accessibility_score, "status": _label(accessibility_score), "checks": accessibility_checks, "note": accessibility.get("note", "")},
        {"id": "technical", "title": "Техническая готовность", "score": technical_score, "status": _label(technical_score), "checks": technical_checks, "note": "HTML/SEO/structured data проверки одной публичной страницы."},
        {"id": "performance", "title": "Вес и сложность страницы", "score": performance_score, "status": _label(performance_score), "checks": performance_checks, "note": "Браузерные метрики текущего запуска; это не лабораторный Core Web Vitals замер."},
        {"id": "security", "title": "Пассивная безопасность", "score": security_score, "status": _label(security_score), "checks": security_checks, "note": security.get("note", "")},
    ]
    return {
        "confidence": {
            "score": confidence,
            "label": "высокая" if confidence >= 80 else "средняя" if confidence >= 55 else "ограниченная",
            "sources": sources,
            "limitations": [
                "Проверена одна публичная страница, а не весь сайт.",
                "Нет данных поведения пользователей, CRM и закрытых кабинетов.",
                "Security-блок пассивный и не заменяет авторизованный pentest.",
            ],
        },
        "pillars": pillars,
        "screenshots": {
            "desktop": {
                "captured": bool(screenshot.get("captured")),
                "preview_data_url": screenshot.get("preview_data_url", ""),
                "viewport": screenshot.get("viewport", {}),
            },
            "mobile": {
                "captured": bool(mobile_screenshot.get("captured")),
                "preview_data_url": mobile_screenshot.get("preview_data_url", ""),
                "viewport": mobile_screenshot.get("viewport", {}),
            },
        },
        "scope": {
            "page": facts.get("url", ""),
            "vertical": context.get("vertical", "generic_landing"),
            "mode": "public_page_evidence",
        },
    }


def _display_cta_texts(values: list[str]) -> list[str]:
    result = _clean_cta_list(values)
    return result or ["не обнаружено в собранных данных"]


def _clean_cta_list(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in _unique(values):
        lowered = value.lower()
        if lowered in CTA_NOISE_WORDS:
            continue
        if _looks_like_url_noise(value):
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
    return result


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
            if isinstance(audit.get("cta_groups"), dict):
                audit["cta_groups"] = {
                    str(key): _clean_cta_list([str(item) for item in value]) if isinstance(value, list) else []
                    for key, value in audit["cta_groups"].items()
                }
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
    cta_groups = facts.get("cta_groups", {}) if isinstance(facts.get("cta_groups"), dict) else {}
    booking_ctas = [
        str(item.get("text", ""))
        for item in facts.get("cta_candidates", [])
        if isinstance(item, dict) and item.get("category") == "booking_cta"
    ][:8]
    if not booking_ctas:
        booking_ctas = [str(item) for item in cta_groups.get("booking_cta", [])][:8]
    contact_ctas = [str(item) for item in cta_groups.get("contact_cta", [])][:8]
    form_submit_ctas = [str(item) for item in cta_groups.get("form_submit", [])][:8]
    secondary_ctas = [str(item) for item in cta_groups.get("secondary_cta", [])][:8]
    navigation_links = [str(item) for item in cta_groups.get("navigation_link", [])][:8]
    first_screen_booking_ctas = [
        str(item.get("text", ""))
        for item in facts.get("cta_candidates", [])
        if isinstance(item, dict) and item.get("category") == "booking_cta" and str(item.get("source", "")).startswith("first_screen")
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
        "first_screen_booking_ctas": _unique(first_screen_booking_ctas)[:8],
        "contact_ctas": _unique(contact_ctas)[:8],
        "form_submit_ctas": _unique(form_submit_ctas)[:8],
        "secondary_ctas": _unique(secondary_ctas)[:8],
        "navigation_links": _unique(navigation_links)[:8],
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
    booking_cta = bool(signals.get("booking_ctas"))
    first_screen_booking_cta = bool(signals.get("first_screen_booking_ctas"))
    contact_cta = bool(signals.get("contact_ctas")) or parser.phone_links + parser.whatsapp_links > 0
    mostly_navigation = bool(signals.get("navigation_links")) and not booking_cta
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
            _hotel_cta_score(booking_cta, first_screen_booking_cta, contact_cta, parser.forms > 0, mostly_navigation),
            [
                _hotel_cta_problem(signals),
                "CTA должен звучать как действие гостя: проверить свободные номера, узнать цену на даты, забронировать номер.",
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
            _score(38, (parser.viewport, 12), (first_screen_booking_cta, 14), (booking_cta, 8), (signals["has_contacts"], 6), (parser.links < 220, 4)),
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
    return [{"area": area, "score": score, "explanation": _hotel_score_explanation(area, score, signals), "problems": problems[:3]} for area, score, problems in raw]


def _hotel_cta_score(booking_cta: bool, first_screen_booking_cta: bool, contact_cta: bool, has_form: bool, mostly_navigation: bool) -> int:
    score = _score(34, (booking_cta, 18), (first_screen_booking_cta, 22), (contact_cta, 8), (has_form, 5))
    if not booking_cta:
        score = min(score, 72)
    if not first_screen_booking_cta:
        score = min(score, 76)
    if mostly_navigation:
        score = min(score, 66)
    return score


def _hotel_cta_problem(signals: dict[str, Any]) -> str:
    booking = _display_cta_texts(list(signals.get("booking_ctas", [])))
    navigation = _clean_cta_list(list(signals.get("navigation_links", [])))
    contact = _clean_cta_list(list(signals.get("contact_ctas", [])))
    if booking and booking != ["не обнаружено в собранных данных"]:
        return f"Найдены CTA бронирования: {', '.join(booking)}. Проверьте, видны ли они на первом экране и ведут ли сразу к датам/цене."
    if navigation:
        return f"В собранных данных видна в основном навигация: {', '.join(navigation[:5])}. Это помогает изучать сайт, но не заменяет CTA бронирования."
    if contact:
        return f"Найдены быстрые контакты: {', '.join(contact)}. Для отеля этого мало без отдельного действия “Проверить свободные номера”."
    return "Явный CTA бронирования не обнаружен в собранных данных: пользователю нужно самому искать путь к датам, цене и номеру."


def _hotel_score_explanation(area: str, score: int, signals: dict[str, Any]) -> str:
    if area == "CTA бронирования":
        if not signals.get("booking_ctas"):
            return "Оценка снижена: конверсионный CTA бронирования не найден, а навигационные ссылки не считаются полноценным booking-сценарием."
        if not signals.get("first_screen_booking_ctas"):
            return "CTA бронирования найден, но нет подтверждения, что он заметен на первом экране. Для отеля это критично."
        return "CTA бронирования найден и выглядит ближе к целевому сценарию: теперь важно связать его с датами, ценой и доверием."
    if area == "Прямое бронирование":
        if not signals.get("hotel_direct_booking_matches"):
            return "Оценка снижена: не обнаружен явный аргумент, почему бронировать напрямую выгоднее, чем через OTA/Booking."
        if not signals.get("booking_ctas"):
            return "Есть намёк на официальный сайт, но он не связан с заметным действием бронирования. Гость всё ещё может уйти сравнивать условия на Booking."
    if area == "Номера и категории" and not signals.get("hotel_availability_matches"):
        return "Есть признаки номеров, но путь к датам, цене и доступности нужно сделать заметнее."
    if area == "UX booking-сценария" and not signals.get("booking_ctas"):
        return "Путь к бронированию выглядит непрямым: пользователь видит разделы сайта, но не видит очевидный следующий шаг к датам и цене."
    if area == "Аудитории: туристы / бизнес / мероприятия" and not signals.get("hotel_business_matches"):
        return "Сценарии гостей нужно развести сильнее: турист, бизнес-гость и организатор мероприятия принимают решение по разным причинам."
    if area == "Конференции, ресторан и SPA" and not signals.get("hotel_food_spa_matches"):
        return "Дополнительные услуги не работают как отдельные продающие входы: им нужны свои CTA и короткие причины перейти дальше."
    return _score_explanation(score)


def _hotel_score_cap(signals: dict[str, Any]) -> int:
    cap = 84
    if not signals.get("hotel_direct_booking_matches"):
        cap = min(cap, 74)
    if not signals.get("hotel_booking_matches") and not signals.get("booking_ctas"):
        cap = min(cap, 70)
    if not signals.get("booking_ctas"):
        cap = min(cap, 72)
    if signals.get("booking_ctas") and not signals.get("first_screen_booking_ctas"):
        cap = min(cap, 78)
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
    cta_evidence = _display_cta_texts(list(signals.get("booking_ctas", [])) + list(signals.get("contact_ctas", [])))
    form_evidence = _clean_cta_list(list(signals.get("form_submit_ctas", [])))
    navigation_evidence = _clean_cta_list(list(signals.get("navigation_links", [])))
    if cta_evidence and cta_evidence != ["не обнаружено в собранных данных"]:
        buttons = ", ".join(cta_evidence)
    elif form_evidence:
        buttons = f"booking CTA не обнаружен; найдена обычная отправка формы: {', '.join(form_evidence[:3])}"
    elif navigation_evidence:
        buttons = f"конверсионные CTA не обнаружены; навигация: {', '.join(navigation_evidence[:6])}"
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
            f"На странице есть разделы номеров и контактов, но путь к проверке дат и цены не выглядит как главное действие. Найдено: {buttons}.",
            "Для отеля главный сценарий — проверить свободные номера, увидеть цену на даты и забронировать.",
            "Закрепить формулировки “Проверить свободные номера”, “Забронировать номер”, “Узнать цену на даты” на первом экране, в блоке номеров и в финале страницы.",
            "низкая",
            "высокий",
            "P1",
            "дизайнер/разработчик",
            evidence=f"Конверсионные CTA: {buttons}",
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


def _ready_hero(context: dict[str, Any]) -> dict[str, Any]:
    if _is_hotel_context(context):
        region = f" в {context['region']}" if context.get("region") else ""
        return {
            "title": "Пример первого экрана",
            "h1": f"Отель{region} для деловых поездок, отдыха и мероприятий",
            "subheadline": "Проверьте свободные номера на нужные даты, сравните категории и забронируйте напрямую на официальном сайте.",
            "primary_button": "Проверить свободные номера",
            "secondary_button": "Забронировать конференц-зал",
            "advantages": [
                "Прямое бронирование без лишних посредников",
                f"Удобная локация{region or ' рядом с ключевыми точками города'}",
                "Номера, ресторан и конференц-залы в одном месте",
            ],
            "microcopy": "Покажем доступные категории, условия проживания и актуальную цену на выбранные даты.",
            "visual": "Фотография номера или фасада с живым светом, рядом мини-карточка с датами заезда/выезда и кнопкой проверки наличия.",
            "trust_elements": [
                "рейтинг и количество отзывов",
                "адрес/локация рядом с CTA",
                "телефон или WhatsApp для быстрого уточнения",
            ],
        }
    return {
        "title": "Пример первого экрана",
        "h1": f"{_capitalize(context['site_type'])}: понятное предложение для цели “{context['goal']}”",
        "subheadline": "Покажите результат, для кого услуга, почему вам можно доверять и какой следующий шаг сделать.",
        "primary_button": _cta_variants(context)[0],
        "secondary_button": "Получить консультацию",
        "advantages": ["понятный результат", "быстрый следующий шаг", "доказательства доверия рядом с CTA"],
        "microcopy": "Ответим и подскажем лучший следующий шаг без лишней сложности.",
        "visual": "Фото продукта, команды или результата, которое подтверждает оффер.",
        "trust_elements": ["отзывы", "кейсы", "контакты"],
    }


def _first_screen_review(
    parser: _PageParser,
    audit_facts: dict[str, Any],
    signals: dict[str, Any],
    context: dict[str, Any],
    ready_hero: dict[str, Any],
) -> dict[str, Any]:
    blocks = [item for item in audit_facts.get("first_screen_blocks", []) if isinstance(item, dict)]
    h1_values = audit_facts.get("h1") or parser.h1 or []
    h1 = _clean_text(str(h1_values[0] if h1_values else ""))
    ctas = _display_cta_texts(list(signals.get("first_screen_booking_ctas") or signals.get("first_screen_ctas") or audit_facts.get("cta_texts") or []))
    trust_items = _clean_cta_list(list(signals.get("trust_matches", [])) + list(signals.get("hotel_review_matches", [])) + list(signals.get("hotel_location_matches", [])))
    forms = audit_facts.get("forms", {}) if isinstance(audit_facts.get("forms"), dict) else {}
    screenshot = audit_facts.get("screenshot", {}) if isinstance(audit_facts.get("screenshot"), dict) else {}
    visual = screenshot.get("visual_analysis", {}) if isinstance(screenshot.get("visual_analysis"), dict) else {}
    visual_notes: list[str] = []
    if visual.get("available"):
        visual_notes.append(f"Скриншот первого экрана: тема {visual.get('theme_guess')}, средняя яркость {visual.get('average_luma')}.")
        if float(visual.get("dark_share") or 0) > 0.65 or float(visual.get("light_share") or 0) > 0.72:
            visual_notes.append("Экран может выглядеть монотонно: стоит проверить контраст CTA, текста и фона.")
        if float(visual.get("colorfulness") or 0) > 52:
            visual_notes.append("Цветов много: стоит проверить, не спорят ли акценты между собой.")
    else:
        visual_notes.append("Визуальный анализ скриншота недоступен; вывод сделан по DOM и HTML evidence.")

    understood = []
    understood.append(f"Главный заголовок найден: {h1}" if h1 else "Явный H1 на первом экране не найден.")
    understood.append(f"CTA на первом экране: {', '.join(ctas[:4])}" if ctas else "Заметный CTA на первом экране не найден в собранных данных.")
    understood.append(
        f"Сигналы доверия рядом с первым экраном: {', '.join(trust_items[:4])}"
        if trust_items
        else "Сигналы доверия рядом с CTA выражены слабо или не найдены."
    )

    friction: list[str] = []
    if not h1:
        friction.append("Пользователь не получает ясный ответ, куда попал и почему это ему нужно.")
    if not ctas:
        friction.append("После 5 секунд непонятно, какой следующий шаг сделать.")
    if not trust_items:
        friction.append("Недостаточно доказательств рядом с решением: отзывы, цифры, лицензии, локация, кейсы или гарантии.")
    if int(forms.get("count") or 0) > 1 and not ctas:
        friction.append("Формы есть, но вход в сценарий заявки/бронирования не выглядит главным действием.")
    if not friction:
        friction.append("Первый экран имеет базовую структуру; основной рост даст усиление оффера, доверия и визуального фокуса.")

    return {
        "title": "Разбор первого экрана",
        "method": "rendered_dom_and_screenshot" if screenshot.get("captured") else "html_dom",
        "screenshot": {
            "captured": bool(screenshot.get("captured")),
            "sha256": screenshot.get("sha256", ""),
            "bytes": screenshot.get("bytes", 0),
            "viewport": screenshot.get("viewport", {}),
            "hero_crop": screenshot.get("hero_crop", {}),
            "visual_analysis": visual,
        },
        "five_second_takeaway": " ".join(understood),
        "found": {
            "h1": h1,
            "ctas": ctas,
            "trust_near_cta": trust_items[:6],
            "visible_blocks": blocks[:12],
            "visual_notes": visual_notes,
        },
        "friction": friction[:6],
        "recommendations": [
            "Сформулировать H1 как конкретный результат для клиента, а не как общее название компании.",
            "Оставить один главный CTA и один вторичный, чтобы первый экран не спорил сам с собой.",
            "Поставить рядом с CTA 2-3 доказательства: цифра, отзыв, лицензия, география, кейс или гарантия.",
            "Использовать реальный визуал продукта, места, результата или команды, а не декоративный фон.",
        ],
        "example_hero": {
            "label": "Пример первого экрана, не финальный дизайн",
            "h1": ready_hero.get("h1", ""),
            "subtitle": ready_hero.get("subheadline", ""),
            "primary_cta": ready_hero.get("primary_button", ""),
            "secondary_cta": ready_hero.get("secondary_button", ""),
            "trust_elements": ready_hero.get("trust_elements", []),
            "visual_direction": ready_hero.get("visual", ""),
        },
        "evidence_note": "Выводы основаны на найденных H1/CTA/формах/тексте, rendered DOM и screenshot metadata; это CRO/UX-аудит, не отчёт Search Console.",
    }


def _one_day_plan(context: dict[str, Any], signals: dict[str, Any]) -> list[dict[str, str]]:
    if _is_hotel_context(context):
        tasks = [
            ("Заменить главный CTA", "дизайнер/разработчик", "30 минут", "Путь к бронированию станет очевиднее", "Первый экран и sticky/mobile CTA"),
            ("Добавить 3 причины бронировать напрямую", "маркетолог/копирайтер", "1 час", "Меньше уходов на Booking/OTA", "Рядом с основной кнопкой и перед блоком номеров"),
            ("Добавить блок для бизнес-гостей", "копирайтер", "1-1,5 часа", "Страница начнёт говорить с гостями в командировке", "После блока номеров или перед конференц-залами"),
            ("Добавить быстрый контакт рядом с бронированием", "разработчик", "30-45 минут", "Гость сможет уточнить условия без поиска контактов", "Hero, блок номеров, мобильная версия"),
            ("Добавить FAQ по оплате, отмене и заселению", "контент-менеджер", "1-2 часа", "Снимаются сомнения перед выбором дат", "Перед финальным CTA"),
        ]
        if signals.get("booking_ctas"):
            tasks[0] = ("Усилить видимость booking CTA", "дизайнер/разработчик", "30 минут", "Существующее действие бронирования станет главным", "Первый экран, блок номеров, финальный CTA")
        return [
            {"task": task, "owner": owner, "time": time, "expected_effect": effect, "placement": placement}
            for task, owner, time, effect, placement in tasks
        ]
    return [
        {"task": "Уточнить H1 и основной CTA", "owner": "копирайтер/дизайнер", "time": "1 час", "expected_effect": "Пользователь быстрее поймёт оффер", "placement": "Первый экран"},
        {"task": "Добавить 3 факта доверия", "owner": "маркетолог", "time": "1 час", "expected_effect": "Больше уверенности перед заявкой", "placement": "Рядом с CTA"},
        {"task": "Сократить путь до заявки", "owner": "разработчик", "time": "1-2 часа", "expected_effect": "Меньше потерь на форме", "placement": "Hero и финальный блок"},
    ]


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
    screenshot = facts.get("screenshot", {}) if isinstance(facts.get("screenshot"), dict) else {}
    screenshot_evidence = {key: value for key, value in screenshot.items() if key != "preview_data_url"}
    if isinstance(screenshot_evidence.get("mobile"), dict):
        screenshot_evidence["mobile"] = {
            key: value for key, value in screenshot_evidence["mobile"].items() if key != "preview_data_url"
        }
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
            "screenshot": screenshot_evidence or {"captured": False},
            "first_screen_blocks": facts.get("first_screen_blocks", [])[:12],
            "first_screen_text": facts.get("first_screen_text", "")[:700],
            "cta_texts": facts.get("cta_texts", [])[:12],
            "cta_groups": facts.get("cta_groups", {}),
            "forms": facts.get("forms", {}),
            "links": facts.get("links", {}),
            "images": facts.get("images", {}),
            "structured_data": facts.get("structured_data", {}),
            "main_text": facts.get("main_text", {}),
            "accessibility": facts.get("accessibility", {}),
            "security": facts.get("security", {}),
            "performance": facts.get("performance", {}),
            "mobile_layout": facts.get("mobile_layout", {}),
            "document": facts.get("document", {}),
            "visual_analysis": (facts.get("screenshot", {}) if isinstance(facts.get("screenshot"), dict) else {}).get("visual_analysis", {}),
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
