# HolyMedia MCP v2: Phase 0

Дата аудита: 20 августа 2026 года  
Исходная ревизия: `386a7c4` (`main`, совпадает с `origin/main`)

## Статус

Это архитектурный аудит и точка остановки Phase 0. Runtime-код, production, staging, БД и env в этой фазе не изменялись. Следующий этап начинается только после отдельного подтверждения архитектуры.

## Что проверено

- исходный репозиторий, deployment-документы, systemd и nginx;
- Python/MCP web runtime, frontend, auth, OAuth, provider adapters и отчёты;
- PostgreSQL live/staging, storage permissions и разделение окружений;
- live/staging `/health`, `/ready`, `/mcp` и security headers;
- unit suite, compileall, frontend syntax-check и MCP registration;
- tracked files, ignore rules, CI/CD и наличие Hermes в этом репозитории.

## Артефакты

1. [Текущая архитектура](CURRENT_ARCHITECTURE_RU.md)
2. [Feature inventory и parity](FEATURE_INVENTORY_RU.md)
3. [Security findings](SECURITY_FINDINGS_RU.md)
4. [Technical debt](TECHNICAL_DEBT_RU.md)
5. [Data model](DATA_MODEL_RU.md)
6. [Provider integration matrix](PROVIDER_INTEGRATION_MATRIX_RU.md)
7. [Migration risks](MIGRATION_RISKS_RU.md)
8. [Proposed v2 architecture](PROPOSED_ARCHITECTURE_RU.md)
9. [Migration plan](MIGRATION_PLAN_RU.md)
10. [Phases and estimates](PHASE_ESTIMATES_RU.md)

## Executive decision

Рекомендуется modular monolith на TypeScript с Next.js App Router, NestJS + Fastify, PostgreSQL, Redis/BullMQ и Docker Compose. Текущий Python MVP не переключается и не удаляется: он остаётся production v1 и источником проверенной бизнес-логики до прохождения parity и миграционных репетиций.

Главные ограничения для Phase 1: не делать big-bang rewrite, не переносить OAuth secrets plaintext, не включать глобальные writes, не мигрировать production data без backup/dry-run/restore test.

## Подтверждённые runtime facts

- Local tests: `231 passed`.
- Registered MCP tools: `135`; отчётный skill и Meta Business/Page tools зарегистрированы.
- Live: `adforge-mcp-web`, `adforge-mcp-http`, nginx и PostgreSQL active.
- Staging: отдельные web/http services, отдельные ports/storage/database active.
- Live `/health=200`, `/ready=200`, `/mcp` без token `401`.
- Staging `/health=200`, `/ready=200`, `/mcp` без token `401`.
- Live PostgreSQL: 9 users, 9 workspaces, 10 platform connections, 191 selected accounts, 0 audit events на момент проверки.
- Staging PostgreSQL: 7 users; provider connections и selected accounts в этой проверке равны 0.
- Hermes/Telegram application code в текущем repository не найден; `Hermes` встречается только в MCP auth test/metadata и пользовательских contact preferences.

