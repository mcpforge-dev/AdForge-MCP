# Phase B: операторская rehearsal

Документ фиксирует последнюю проверку V1 -> V2 на отдельной копии production-состояния. Production V1, публичный hostname, DNS, Nginx, OAuth-приложения и callback URL не изменялись.

## Runtime и Redis

- V2 rehearsal использует отдельную PostgreSQL database и отдельный Redis 7.4.6.
- Redis слушает только private loopback VPS-порта и не опубликован наружу.
- После прогрева зависимостей `/health` и `/ready` возвращают `200`.
- BullMQ worker, retry, deduplication и rate-limit integration прошли CI/integration checks.

## Google Ads live parity

На одном и том же действующем customer и периоде `2026-08-15..2026-08-21` V1 и V2 получили:

- 41 campaign;
- одинаковый SHA-256 hash набора campaign ID;
- spend `976.019831 USD`;
- impressions `226167`;
- clicks `29307`;
- conversions `1521.823727`;
- одинаковый account-level read и healthy diagnostics.

Исправленные причины generic error V2: неправильный REST path `googleAds:searchStream`, несовместимое поле `campaign_budget.currency_code` в metrics query, а также потеря V1 snake_case credential fields и login/manager context при миграции.

## Meta Ads live parity

На одном и том же действующем ad account и периоде V1/V2 получили:

- 4 campaign;
- одинаковый hash набора campaign ID;
- spend `147.83 USD`;
- impressions `54451`;
- Business count `10`;
- Page count `38`;
- Page posts: live, 2 записи;
- Page -> Instagram: linked;
- live permissions: 6 granted, 0 missing;
- diagnostics: healthy.

В clicks и conversions есть документированное semantic difference:

- V1 считает `inline_link_clicks` и суммирует все Meta `actions`;
- V2 использует `insights.clicks` и только явно разрешённые conversion action types.

Поэтому для этого live периода V1 получил `3030 clicks` и `14660 conversions`, а V2 `3136 clicks` и `22 conversions`. Это не потеря ответа API; семантика закреплена в `PROVIDER_METRICS_SEMANTICS_RU.md`.

Page posts используют fallback цепочку полей, чтобы не выдавать permission/API error за пустые данные. Instagram читается через Facebook Page -> `instagram_business_account`.

## MCP и service identities

Временный rehearsal-only service identity с `adforge:mcp:read` подтвердил:

- workspace и account allowlist;
- Google и Meta read operations;
- foreign account rejection;
- write rejection для read-only token;
- revoked и expired token rejection;
- preview/confirmation boundary без реального write.

Plaintext существующего production service token недоступен по архитектуре: в source хранится только SHA-256 digest. Поэтому существующее значение не подменялось и не извлекалось; совместимость digest мигрирована, а operator smoke выполнен на временном scoped token.

## Hermes

Настоящий production Telegram bot не запускался. На VPS нет безопасно выделенного Hermes bot token/chat contour, поэтому production Telegram polling не трогался.

Выполнен локальный E2E с реальным V2 MCP HTTP и fake Telegram transport:

`Telegram-shaped updates -> Hermes V2 -> scoped MCP token -> V2 API -> migrated Google connection`.

Проверены 5 read-сценариев: расходы, активные кампании, ranking, сравнение периодов и follow-up по конверсиям. Write-запрос отклонён до MCP. OpenAI отключён, ответы сформированы deterministic fallback. Hermes не получает provider credentials и не имеет прямого доступа к БД.

## Web и compatibility routes

HTTP smoke внутреннего V2 web runtime: `/`, `/auth`, `/auth/reset`, `/app`, `/dashboard`, `/robots.txt`, `/sitemap.xml`, `/api/health` вернули `200`. Playwright в текущем окружении отсутствует, поэтому полноценный visual browser E2E не заявляется пройденным.

На V2 API сохранены внешние контракты:

- `/oauth/google/callback`;
- `/oauth/meta/callback`;
- `/oauth/yandex/callback`;
- `/oauth/tiktok/callback`;
- `/mcp`;
- legacy auth/MCP routes.

Без credentials они корректно возвращают `401`, а OAuth metadata endpoint доступен. Новые callback URL не вводились.

## Security result и оставшиеся blockers

Logs и smoke outputs не содержат access/refresh tokens, provider secrets, service-token values, encryption keys или cookies. Critical/High findings по выполненным security checks не обнаружены.

Операторские ограничения перед Phase C:

1. Нужен безопасный non-printing smoke с реальным существующим MCP service token, если необходимо доказать именно сохранение конкретного client secret value; plaintext из digest восстановить нельзя.
2. Для полного Telegram E2E нужен отдельный тестовый bot token и allowlisted chat. Production bot не запускать до этого действия.
3. Visual browser E2E требует установленного Playwright/browser runtime; текущий HTTP smoke не заменяет визуальную проверку.
