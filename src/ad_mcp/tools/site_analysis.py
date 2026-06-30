from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


MAX_HTML_BYTES = 350_000
TIMEOUT_SECONDS = 10
MAX_REDIRECTS = 4


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
) -> dict[str, Any]:
    parser = _PageParser()
    parser.feed(html)
    text = _clean_text(" ".join(parser.text_parts))
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]{3,}", text)
    signals = _signals(parser, text)
    context = _context(site_type, goal, audience, region, mode, competitor, concern)
    scores = _scorecards(parser, len(words), signals, context)
    top_issues = _top_issues(parser, len(words), signals, context, scores)
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
        "quick_wins": quick_wins,
        "rewritten_copy": rewritten_copy,
        "recommended_structure": _recommended_structure(context),
        "implementation_plan": implementation_plan,
        "priority_matrix": implementation_plan,
        "questions": _questions(context),
        "evidence": _evidence(parser, text),
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
            "word_count": len(words),
            "truncated": truncated,
            "technical_check_limited": True,
        },
    }
    result["overall_score"] = round(sum(item["score"] for item in scores) / max(1, len(scores)))
    return result


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


def _signals(parser: _PageParser, text: str) -> dict[str, Any]:
    lower = text.lower()
    cta = _matches(lower, ["купить", "заказать", "оставить заявку", "записаться", "получить", "рассчитать", "консультация", "contact", "book", "order"])
    trust = _matches(lower, ["отзывы", "кейс", "сертификат", "гарантия", "партнер", "лет", "клиентов", "лицензия", "команда", "портфолио"])
    price = _matches(lower, ["цена", "стоимость", "тариф", "прайс", "рассчитать"])
    process = _matches(lower, ["как это работает", "этап", "процесс", "шаг", "схема"])
    faq = _matches(lower, ["faq", "вопрос", "ответ", "часто задаваем"])
    return {
        "cta_matches": cta,
        "trust_matches": trust,
        "price_matches": price,
        "process_matches": process,
        "faq_matches": faq,
        "has_contacts": parser.phone_links > 0 or parser.email_links > 0 or parser.whatsapp_links > 0,
        "has_form_or_button": parser.forms > 0 or parser.buttons > 0 or bool(cta),
    }


def _scorecards(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
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


def _top_issues(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any], scores: list[dict[str, Any]]) -> list[dict[str, str]]:
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


def _quick_wins(parser: _PageParser, signals: dict[str, Any], context: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"title": "Переписать H1 под результат", "action": _rewrite_h1(parser, context), "time": "15 минут"},
        {"title": "Заменить CTA", "action": f"Поставьте кнопку “{_cta_variants(context)[0]}” на первом экране.", "time": "10 минут"},
        {"title": "Добавить 3 факта доверия", "action": "Например: годы опыта, количество клиентов, кейс, сертификат или гарантию.", "time": "30 минут"},
        {"title": "Показать быстрый контакт", "action": "Добавьте телефон или WhatsApp рядом с основной кнопкой.", "time": "20 минут"},
        {"title": "Сократить первый экран", "action": "Оставьте один главный смысл, один подзаголовок и один основной CTA.", "time": "30-60 минут"},
        {"title": "Добавить описание страницы", "action": "Сформулируйте 140-160 символов: услуга, выгода, город/ниша и действие.", "time": "10 минут"},
    ]


def _rewritten_copy(parser: _PageParser, context: dict[str, Any]) -> dict[str, Any]:
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


def _recommended_structure(context: dict[str, Any]) -> list[dict[str, str]]:
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


def _summary(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any]) -> str:
    if not parser.title and not parser.h1:
        return "Страница загружается, но базовая структура с title/H1 выглядит слабой: оффер нужно прояснить."
    if signals["has_form_or_button"] and signals["trust_matches"]:
        return "У страницы есть базовые элементы заявки и доверия, но их стоит усилить и выстроить в более понятный путь к конверсии."
    if word_count < 250:
        return "Страница выглядит слишком короткой для уверенной заявки: нужно усилить оффер, доверие, объяснение процесса и CTA."
    return "Страница доступна для анализа. Ниже — приоритеты по первому экрану, офферу, текстам, UX и конверсии."


def _verdict(parser: _PageParser, word_count: int, signals: dict[str, Any], context: dict[str, Any], scores: list[dict[str, Any]]) -> dict[str, Any]:
    weakest = sorted(scores, key=lambda item: item["score"])[:3]
    return {
        "summary": _summary(parser, word_count, signals, context),
        "does_well": [
            "Страница открывается и даёт материал для анализа.",
            "Есть базовая структура контента." if parser.h1 or parser.h2 else "Контент можно быстро пересобрать в понятную структуру.",
        ],
        "main_risk": f"Главный риск: пользователь не увидит достаточно причин оставить {context['goal']} прямо сейчас.",
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
        key = re.sub(r"[^a-zа-я0-9]+", " ", item["title"].lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _evidence(parser: _PageParser, text: str) -> dict[str, Any]:
    snippets = [part for part in parser.text_parts if len(part) > 28][:6]
    return {
        "title": parser.title,
        "h1": parser.h1[:3],
        "h2": parser.h2[:6],
        "buttons": parser.button_texts[:6],
        "text_snippets": snippets,
        "contacts": {
            "phone_links": parser.phone_links,
            "email_links": parser.email_links,
            "whatsapp_links": parser.whatsapp_links,
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
    region = f" в {context['region']}" if context["region"] else ""
    return f"{_capitalize(context['site_type'])}{region}, который помогает получать {context['goal']} без лишних шагов"


def _cta_variants(context: dict[str, Any]) -> list[str]:
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
