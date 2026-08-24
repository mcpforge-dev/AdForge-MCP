# UI/UX и OAuth: этап 2 поверх V2

Дата: 2026-08-24

## Граница изменения

Этап восстанавливает полезные пользовательские паттерны из исторического V1
commit `c700fb7` поверх V2. Не изменялись PostgreSQL, Redis, provider
credentials, provider connections, account IDs, service-token digests, OAuth
applications, публичные callback URLs, DNS и Nginx contract. Provider writes не
выполнялись.

## Выполнено

- OAuth callback для Meta, Google Ads, Yandex и TikTok возвращает пользователя
  в `Подключения`, передаёт безопасный статус и выделяет нужную provider-card.
  Google Login использует отдельный исторически совместимый callback
  `/auth/google/callback`, а не callback Google Ads.
- Layout внутренних страниц использует единый flex shell: footer находится у
  нижней границы короткого viewport и совпадает с основной content grid.
  Overview steps 1/2/3 больше не имеют отдельного левого отступа.
- `Подключения` показывает компактные provider-card. Списки кабинетов
  открываются по запросу, поддерживают `Выбрать все`, `Снять все` и одно
  явное сохранение. Повторный disconnect идемпотентен, исторические кабинеты
  не удаляются, а действие требует подтверждения.
- `Отчёты` возвращают композицию V1: выбор кабинета, период 7/14/30/90 дней,
  реальную передачу выбранного периода, DOCX-generation, loading/error state
  и исторический правый preview-блок. PDF не заявляется, потому что V2 report
  engine сейчас выдаёт только DOCX.
- `AI-клиент` не дублирует управление кабинетами: source of truth остаётся
  `Подключения`. Сохранены отдельные понятные инструкции для ChatGPT, Claude
  и Codex.
- Восстановлен V1-like раздел `Анализ сайта`: quick/full режим, необязательный
  brief, честный progress, структурированный детерминированный результат,
  история и DOCX. Новый V2 analyser анализирует только безопасно полученный
  public HTML, сохраняет SSRF boundary и не использует V1 Python runtime.
- Auth сохраняет V2 session/security flow, но возвращает V1-like UX: две
  вкладки, Google button с asset, контекстное восстановление пароля и
  корректный прямой `/auth?mode=signup`. Исправлен lifecycle submit при
  навигации после login.
- В навигации добавлен отключённый пункт `SEO · Скоро`; profile/password card,
  notices, spacing и mobile layout приведены к общей сетке без раскрытия
  внутренних V2 terminology.

## Проверка до deploy

- изменённые файлы: Prettier PASS;
- lint: PASS;
- typecheck: PASS;
- build: PASS;
- unit/API/Hermes/worker suite: PASS (`70` API passed; integration tests,
  которым требуются external PostgreSQL/Redis, выполняются в CI);
- standalone Playwright desktop/mobile: `9 passed`, `1 skipped` по
  desktop-only guard;
- axe public/private desktop/mobile: PASS, automated violations `0`;
- secret scan: PASS;
- dependency audit: PASS.

Глобальная `format:check` остаётся известным baseline debt в 172 несвязанных
файлах монорепо. Для затронутых файлов применена и проверена актуальная
Prettier-конфигурация; массовый unrelated rewrite не выполнялся.

## CI и production deploy

- GitHub Actions для code commit `7f246be8e36e4566f61f798b27da16e4dfdfac6d`:
  foundation PASS, Compose smoke PASS, browser/compatibility PASS (`9 passed`,
  `1 skipped`) и GHCR production-image PASS.
- immutable image: `ghcr.io/mcpforge-dev/holymedia-mcp-v2:sha-7f246be8e36e4566f61f798b27da16e4dfdfac6d`;
  registry digest: `sha256:89f11840e176ff0e40d4bf795e891dfd067ef5a134fd25ee957d53d9e73dc8b5`.
- predeploy checkpoint: `/var/backups/adforge-mcp/ui-stage2-predeploy-20260824T134939Z`;
  PostgreSQL custom dump ненулевой, V2 env/config, production compose config и
  Nginx config сохранены, SHA-256 проверены.
- Обновлены только `api`, `web`, `worker` через `docker compose pull` и
  `up -d --no-deps --force-recreate`. PostgreSQL и Redis volumes, Nginx, DNS,
  OAuth applications и callback URLs не менялись. Предыдущий image
  `sha-ff3bb7...` сохранён как rollback artifact.
- после deploy: `/health` `200`, `/ready` `200`, `/mcp` без token `401`,
  `/auth?mode=signup` `200`; API/Web healthy, Worker running.
- standalone production Playwright desktop/mobile: `9 passed`, `1 skipped`;
  axe automated violations `0`. Все запросы, которые E2E имитирует как
  пользовательские API actions, были изолированы Playwright route mocks,
  поэтому production provider data не изменялись.

## Provider/account integrity

Post-deploy read-only PostgreSQL validation: users `11`, workspaces `11`,
memberships `11`, connections `11`, accounts `255`, credential envelopes `9`,
service tokens `12`, entitlements `11`. Orphan accounts `0`, cross-tenant
mismatches `0`, duplicate connection/account bindings `0`. Состояния Meta,
Yandex и TikTok connections сохранены; V2 provider code и credential boundary
этим UI deploy не менялись, provider writes `0`. Current runtime readiness
green; sensitive-log pattern scan не обнаружил plaintext credentials, OAuth
tokens, service-token plaintext или passwords.

Telegram Hermes real E2E остаётся `DEFERRED BY PROJECT DECISION`.
