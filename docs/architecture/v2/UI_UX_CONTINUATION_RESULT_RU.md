# Продолжение восстановления UI/UX V1 поверх V2

Дата: 2026-08-24

## Scope

Выполнен точечный проход пользовательского интерфейса без отката V2 backend. Источниками reference оставались V1 commit `c700fb7`, текущие V2 API contracts и ранее согласованный UX restoration baseline.

Изменения затронули только web UI, browser fixtures и accessibility regression coverage. PostgreSQL, Redis, provider credentials, connections, account IDs, service-token model, OAuth applications и public callback contract не менялись.

## Реализовано

- OAuth callback возвращает пользователя в `Connections`, выделяет подключённую provider-card и раскрывает список кабинетов.
- Внутренние страницы используют flex layout с footer у нижнего края viewport при коротком содержимом; footer и Overview steps выровнены по общей сетке.
- Reports получили выбор кабинета, период 7/14/30 дней, реальное использование периода при генерации DOCX и восстановленный правый preview-блок.
- AI-client больше не дублирует выбор кабинетов: scope берётся из выбранных кабинетов в Connections; сохранены отдельные инструкции Codex, Claude и ChatGPT.
- Connections показывают четыре компактные provider-card; кабинеты открываются по запросу, selection сохраняется одной операцией с feedback, есть bulk select/clear.
- Disconnect оформлен как подтверждаемое danger-действие.
- Восстановлен раздел «Анализ сайта» на существующих V2 site-analysis endpoints с history, результатом, progress state и DOCX download.
- Auth UI получил Google button с icon, contextual password recovery и проверенный `/auth?mode=signup`; mobile auth не переполняется.
- Profile password card и основные spacing/grid rules приведены к общей системе.

## Проверка до deploy

- затронутые файлы Prettier: PASS;
- lint: PASS;
- typecheck: PASS;
- production build: PASS;
- Node unit/API suite: PASS; локальные PostgreSQL/Redis integration tests выполняются в CI;
- V1 Python suite через project `.venv`: `239 passed`;
- standalone Playwright desktop/mobile: `9 passed`, `1 skipped` по desktop-only guard;
- axe desktop/mobile public/private surfaces: `0` violations;
- secret scan: PASS;
- dependency audit: PASS;
- GitHub Actions foundation, Compose smoke, browser/compatibility E2E и GHCR image build: PASS.

Global repository `format:check` всё ещё отражает существующий baseline formatting debt в unrelated files; затронутые файлы проверены отдельно и используют актуальный формат.

## Production deploy

- code commit: `ff3bb7a1d1daeca2696cc504dfdc9bb71a6e4e97`;
- immutable image: `ghcr.io/mcpforge-dev/holymedia-mcp-v2:sha-ff3bb7a1d1daeca2696cc504dfdc9bb71a6e4e97`;
- predeploy backup: `/var/backups/adforge-mcp/ui-restore-predeploy-20260824T113536Z`;
- backup содержит PostgreSQL dump, deployment env/config, Nginx config и `SHA256SUMS`; все checksums verified;
- обновлены только V2 `api`, `web`, `worker`; PostgreSQL и Redis volumes сохранены;
- Nginx `nginx -t`: PASS, reload выполнен; hostname, DNS, TLS и OAuth callback URLs не менялись;
- static asset routes выделены из общего burst limit, API/auth/OAuth/MCP limits сохранены.

## Production smoke

- public `/health`: `200`;
- public `/ready`: `200`;
- public `/mcp` без token: `401`;
- public desktop/mobile homepage и auth: `200`, без console errors, failed requests и horizontal overflow;
- Web/API/Worker/PostgreSQL/Redis: healthy;
- Meta read-only: campaigns, metrics, diagnostics, Business/Page/Instagram и permissions path прошли; write, foreign-account, revoked и expired token checks отклонены;
- Yandex Direct и TikTok Ads read-only account discovery прошли;
- provider writes: `0`.

## Data integrity

Свежий predeploy PostgreSQL dump и postdeploy database дают одинаковые counts: users `11`, workspaces `11`, memberships `11`, connections `11`, accounts `255`, credentials `9`, service tokens `12`, entitlements `11`. Orphan accounts `0`, cross-tenant mismatches `0`, duplicate bindings `0`.

Ранее переданный ориентир `10/191` не совпал со свежим production dump: значения `11/255` уже присутствовали до UI deploy и не изменились в ходе deploy. Данные не откатывались и не исправлялись догадками.

## Deferred items

Telegram Hermes real E2E остаётся `DEFERRED BY PROJECT DECISION`. Payment gateway и расширенный live reporting Yandex/TikTok остаются вне scope. V2 backend/security/data integrity сохранены.
