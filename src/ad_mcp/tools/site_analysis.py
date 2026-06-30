from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


MAX_HTML_BYTES = 350_000
TIMEOUT_SECONDS = 10


class SiteAnalysisError(ValueError):
    pass


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.meta_description = ""
        self.viewport = False
        self.canonical = False
        self.h1: list[str] = []
        self.h2: list[str] = []
        self.links = 0
        self.images = 0
        self.images_without_alt = 0
        self.buttons = 0
        self.forms = 0
        self._capture: str | None = None
        self._buffer: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): (value or "") for key, value in attrs}
        tag = tag.lower()
        if tag in {"title", "h1", "h2", "button"}:
            self._capture = tag
            self._buffer = []
        if tag == "meta":
            name = attrs_dict.get("name", "").lower()
            if name == "description":
                self.meta_description = attrs_dict.get("content", "").strip()
            if name == "viewport":
                self.viewport = True
        if tag == "link" and attrs_dict.get("rel", "").lower() == "canonical":
            self.canonical = True
        if tag == "a" and attrs_dict.get("href"):
            self.links += 1
        if tag == "img":
            self.images += 1
            if not attrs_dict.get("alt", "").strip():
                self.images_without_alt += 1
        if tag == "button":
            self.buttons += 1
        if tag == "form":
            self.forms += 1

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
            elif tag == "button" and value:
                self.text_parts.append(value)
            self._capture = None
            self._buffer = []

    def handle_data(self, data: str) -> None:
        text = _clean_text(data)
        if not text:
            return
        if self._capture:
            self._buffer.append(text)
        self.text_parts.append(text)


def analyze_site_improvements(url: str) -> dict[str, Any]:
    normalized = _validate_public_url(url)
    try:
        request = Request(
            normalized,
            headers={
                "User-Agent": "HolyMedia-MCP-SiteAnalysis/1.0",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310 - URL is validated against SSRF targets.
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
        return _error_result(normalized, str(exc) or "Не удалось загрузить страницу для анализа.")

    return analyze_html(html, url=normalized, http_status=status, truncated=truncated)


def analyze_html(html: str, *, url: str = "", http_status: int = 200, truncated: bool = False) -> dict[str, Any]:
    parser = _PageParser()
    parser.feed(html)
    text = _clean_text(" ".join(parser.text_parts))
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]{3,}", text)
    cta_words = _cta_matches(text)
    recommendations = _recommendations(parser, len(words), cta_words)
    return {
        "status": "ok",
        "url": url,
        "http_status": http_status,
        "summary": _summary(parser, len(words), cta_words),
        "priority_recommendations": recommendations[:6],
        "checks": {
            "title": parser.title,
            "meta_description_present": bool(parser.meta_description),
            "h1_count": len(parser.h1),
            "h2_count": len(parser.h2),
            "viewport_present": parser.viewport,
            "canonical_present": parser.canonical,
            "links_count": parser.links,
            "images_count": parser.images,
            "images_without_alt": parser.images_without_alt,
            "forms_count": parser.forms,
            "buttons_count": parser.buttons,
            "cta_mentions": cta_words,
            "word_count": len(words),
            "truncated": truncated,
        },
    }


def build_site_analysis_tools() -> dict[str, callable]:
    return {"analyze_site_improvements": analyze_site_improvements}


def _recommendations(parser: _PageParser, word_count: int, cta_words: list[str]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    if not parser.title or len(parser.title) < 25:
        items.append(_item("Видимость", "high", "Уточните заголовок страницы: добавьте услугу, город/нишу и ключевое обещание."))
    if not parser.meta_description:
        items.append(_item("Текст", "medium", "Добавьте короткое описание страницы с выгодой и понятным призывом к действию."))
    if len(parser.h1) != 1:
        items.append(_item("Структура", "high", "Сделайте один главный H1, который сразу объясняет предложение страницы."))
    if not parser.viewport:
        items.append(_item("UX", "high", "Добавьте viewport meta, чтобы мобильная версия корректно масштабировалась."))
    if word_count < 250:
        items.append(_item("Тексты", "medium", "Усилите страницу текстом: кому подходит услуга, чем вы полезны и почему можно доверять."))
    if not cta_words and parser.buttons == 0 and parser.forms == 0:
        items.append(_item("Конверсия", "high", "Добавьте заметный CTA на первом экране: заявка, консультация, расчёт или запись."))
    if parser.images and parser.images_without_alt:
        items.append(_item("Доступность", "low", "Добавьте описания к важным изображениям, чтобы страница была понятнее людям и системам анализа."))
    if len(parser.h2) < 2:
        items.append(_item("Структура", "medium", "Разбейте страницу на понятные блоки: выгоды, процесс, кейсы, FAQ и контакты."))
    if not parser.canonical:
        items.append(_item("Структура", "low", "Проверьте, что у страницы есть понятная основная версия и нет дублей для одной и той же услуги."))
    if not items:
        items.append(_item("Конверсия", "medium", "Проверьте первый экран вручную: оффер, доверие и CTA должны быть видны без скролла."))
    return items


def _summary(parser: _PageParser, word_count: int, cta_words: list[str]) -> str:
    if not parser.title and not parser.h1:
        return "Страница загружается, но базовая структура с title/H1 выглядит слабой."
    if cta_words:
        return f"Страница содержит базовую структуру и CTA-сигналы: {', '.join(cta_words[:3])}."
    if word_count < 250:
        return "Страница выглядит короткой: стоит усилить оффер, доверие и призыв к действию."
    return "Страница доступна для анализа; основные улучшения ниже отсортированы по приоритету."


def _item(area: str, priority: str, recommendation: str) -> dict[str, str]:
    return {"area": area, "priority": priority, "recommendation": recommendation}


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
            raise SiteAnalysisError("Для безопасности можно анализировать только публичные сайты.")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _cta_matches(text: str) -> list[str]:
    variants = ["купить", "заказать", "оставить заявку", "записаться", "получить", "рассчитать", "консультация", "contact", "book", "order"]
    lower = text.lower()
    return [word for word in variants if word in lower]


def _charset_from_content_type(content_type: str) -> str:
    match = re.search(r"charset=([\w.-]+)", content_type, flags=re.I)
    return match.group(1) if match else "utf-8"


def _error_result(url: str, message: str) -> dict[str, Any]:
    return {
        "status": "error",
        "url": url,
        "summary": "Не удалось выполнить анализ сайта.",
        "error": message,
        "priority_recommendations": [
            _item("Доступность", "high", "Проверьте, что сайт открыт публично и возвращает HTML-страницу без блокировки ботов.")
        ],
        "checks": {},
    }
