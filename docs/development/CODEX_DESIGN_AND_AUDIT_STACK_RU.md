# Codex Design And Audit Stack

Цель этого стека: HolyMedia MCP должен помогать Codex работать как арт-директор, UX/UI-дизайнер, аналитик сайта и дизайнер клиентских отчётов, а не только генерировать CSS и общие рекомендации.

## Что уже было в проекте

- Python backend без React/Tailwind build pipeline.
- `playwright` в optional dependency `site-audit` для rendered DOM и screenshot evidence.
- `beautifulsoup4` и `lxml` в optional dependency `site-audit` для HTML parsing.
- `src/ad_mcp/tools/site_analysis.py` с SSRF-safe URL validation, static HTML fetch, Playwright render, CTA extraction, niche rule packs, scoring, quick wins, hero copy и evidence.
- SEO dashboard с Search Console данными, inline SVG trend chart, CSV/RTF export.
- Исторический Site analysis export в HTML-as-Word `.doc`, который открывался в Word/Google Docs.

## Что добавлено

- `Pillow` в `site-audit`: анализ screenshot первого экрана, размеры viewport, hero crop metadata, brightness/theme/colorfulness signals.
- `trafilatura` в `site-audit`: дополнительное извлечение основного текста страницы без замены BeautifulSoup/lxml.
- `python-docx` в `site-audit`: серверная генерация настоящего `.docx` отчёта с диагностикой, screenshots, первым экраном, приоритетами и планом внедрения.
- `scripts/design_audit_playwright.py`: dev-команда для desktop/mobile screenshots, overflow checks и базовых accessibility signals. Результаты сохраняются в `.local/design-audit`, эта папка ignored.
- `first_screen_review` в AI-анализе сайта: отдельный блок “Разбор первого экрана” с 5-second takeaway, найденными H1/CTA/trust, friction, visual signals и “Примером первого экрана”.
- `audit_overview` в AI-анализе сайта: confidence и sources, desktop/mobile screenshot preview, accessibility/mobile UX, HTML/SEO, browser performance и пассивная проверка security headers.
- Rendered DOM audit: доступные имена кнопок/ссылок, label полей, duplicate IDs, heading order, mobile overflow, touch targets, мелкий текст и landmarks.
- Response headers audit: HTTPS, CSP, HSTS, clickjacking protection, `nosniff`, Referrer Policy, Permissions Policy и cross-origin policies без активной эксплуатации.
- Staging deploy устанавливает `.[google,meta,postgres,site-audit]` и Chromium для Playwright.

## Что не добавлено

- `echarts` или `chart.js`: текущий frontend без bundler/package.json, SEO trend уже работает на inline SVG. Подключать chart library без реального использования не нужно.
- `@axe-core/playwright`, `pa11y`, `@lhci/cli`: это Node tooling, а в проекте пока нет Node test/lint pipeline. Базовые проверки делаются через Playwright script; полноценный axe/pa11y/LHCI стоит добавить отдельным шагом, когда появится Node toolchain.
- Tailwind, shadcn/ui, Radix, Motion: текущий UI не на React/Tailwind. Миграция ради одной задачи не нужна и может сломать dashboard.

## Codex Skills

Созданы локальные skills:

- `~/.codex/skills/design-director/SKILL.md` — арт-дирекция, визуальная иерархия, сетка, типографика, premium B2B SaaS.
- `~/.codex/skills/ux-auditor/SKILL.md` — UX flow audit, onboarding, OAuth/login/refresh/error states.
- `~/.codex/skills/report-designer/SKILL.md` — клиентские отчёты, executive summary, evidence, action plan, Word/Google Docs compatibility.
- `~/.codex/skills/site-audit-pro/SKILL.md` — evidence-based CRO/UX site audit, niche rule packs, first-screen evidence.
- `~/.codex/skills/hero-screen-review/SKILL.md` — screenshot/URL first-screen review, H1/CTA/trust/visual direction.

## Как Codex должен пользоваться этим

1. Для UI-задач сначала использовать `design-director`, затем проверять экран скриншотом.
2. Для flow-задач использовать `ux-auditor` и проходить happy path, error path, refresh, mobile.
3. Для сайтов использовать `site-audit-pro`; не смешивать Search Console SEO с CRO/UX-аудитом.
4. Для первого экрана использовать `hero-screen-review`; любой hero copy маркировать как пример.
5. Для документов и выгрузок использовать `report-designer`; отчёт должен быть пригоден для клиента.

## Dev-команда визуальной проверки

```powershell
.venv\Scripts\python.exe scripts\design_audit_playwright.py https://staging-mcp.holymedia.kz
```

Команда:

- валидирует, что URL публичный `http/https`;
- делает desktop и mobile screenshots;
- проверяет horizontal overflow;
- считает buttons without accessible name и images without alt;
- сохраняет `audit.json` и screenshots в `.local/design-audit/<timestamp>`.

Скриншоты и audit JSON не коммитить.

## Проверки перед staging

```powershell
.venv\Scripts\python.exe -m pytest -q
python -m compileall src scripts
node --check src/ad_mcp/web/static/app.js
git diff --check
```

Если позже добавится Node toolchain для axe/pa11y/LHCI, добавить отдельный npm script и запускать его только там, где установлены browsers/deps.
