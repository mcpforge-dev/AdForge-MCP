# Beta demo script HolyMedia MCP

Сценарий рассчитан на короткую демонстрацию 10-15 минут. Он показывает hosted-модель, OAuth onboarding, MCP tools и preview-only безопасность.

## Цель demo

Показать, что HolyMedia MCP уже работает как hosted MCP-сервис:

- клиент открывает dashboard;
- подключает рекламные кабинеты через OAuth;
- выбирает accounts;
- копирует hosted MCP URL;
- подключает endpoint в AI-клиент;
- получает accounts/campaigns/metrics через MCP tools;
- опасные действия видит только в preview.

## 1. Открытие и вход

Коротко сказать:

> HolyMedia MCP не требует от клиента скачивать проект или запускать сервер. Сервер уже развернут на VPS/WPS. Клиент подключает рекламные кабинеты через dashboard и использует hosted MCP endpoint в Codex, Claude или другом MCP-клиенте.

Показать token gate:

- экран `HolyMedia MCP Beta` с полем `Beta access token`;
- ввести beta token, нажать `Enter dashboard`;
- токен после входа нигде не показывается; в header есть `Sign out`.

## 2. Overview

Показать раздел `Overview`:

- бейдж `Preview-only: ON` в header;
- счётчики connected platforms / connected accounts;
- live URL и блок `Connect to MCP client` с `Copy MCP URL`;
- список `Next steps` (выполненные шаги отмечены галочкой).

## 3. Connections dashboard

Открыть `Connections`.

Показать карточки:

- Meta Ads;
- Google Ads;
- TikTok Ads;
- Yandex Direct.

Объяснить:

- Meta/Google являются primary beta platforms;
- TikTok/Yandex имеют OAuth groundwork и могут быть limited по campaigns/metrics;
- секреты не отображаются в dashboard;
- токены хранятся только server-side.

## 3. OAuth onboarding

Если есть реальные credentials:

1. Нажать `Connect` у Meta или Google.
2. Пройти OAuth consent.
3. Вернуться в dashboard.
4. Показать pending account selection.
5. Выбрать аккаунт.
6. Сохранить.
7. Показать статус connected/MCP ready.

Если реальные credentials недоступны:

1. Показать authorize URL/diagnostics.
2. Объяснить, какие env variables нужны.
3. Не имитировать успешное подключение.

## 4. Diagnostics

Показать:

- platform diagnostics;
- `/api/diagnostics/mcp`;
- `/api/diagnostics/security`;
- `/api/beta/capabilities`.

Акценты:

- beta token обязателен;
- preview-only включен;
- live writes выключены;
- tokens не возвращаются;
- fake metrics не используются.

## 5. Подключение MCP client

Показать на примере Codex или Claude:

- Name: `HolyMedia MCP`;
- URL: `https://your-domain.com/mcp`;
- Auth: `Authorization: Bearer <BETA_TOKEN>`.

Если UI клиента отличается, объяснить общий принцип: нужен hosted MCP URL и bearer token.

## 6. Проверочные запросы в AI-клиенте

Запрос 1:

```text
Проверь диагностику HolyMedia MCP.
```

Ожидаемо: краткий статус backend, MCP, platforms, env readiness, connected accounts.

Запрос 2:

```text
Покажи подключенные рекламные аккаунты.
```

Ожидаемо: список accounts из hosted OAuth connections.

Запрос 3:

```text
Покажи кампании Meta Ads.
```

Ожидаемо: реальные campaigns, если Meta подключена; иначе понятная ошибка или `not_available`.

Запрос 4:

```text
Покажи базовые метрики за последние 7 дней.
```

Ожидаемо: spend, impressions, clicks, ctr, cpc, cpm, conversions/cost_per_conversion если доступны. Если provider data недоступны, ответ должен честно сказать об этом.

Запрос 5:

```text
Сделай preview изменения бюджета кампании, но ничего не применяй.
```

Ожидаемо: `mode=preview_only`, `will_apply=false`, current/requested values, risk level и note, что реальное изменение не выполнено.

## 7. Safety moment

Показать, что beta не применяет реальные write-действия:

- `AD_MCP_PREVIEW_ONLY=true`;
- `live_writes_enabled=false`;
- `commit_preview` заблокирован;
- provider write endpoints не вызываются.

Фраза для встречи:

> На beta мы сознательно не даем ИИ менять рекламные кабинеты напрямую. Сначала собираем доверие через read tools, diagnostics и preview-only сценарии.

## 8. Ограничения beta

Проговорить честно:

- это hosted beta, не финальный multi-tenant SaaS;
- один beta token является временной моделью доступа;
- `tokens/connections.json` используется как beta storage;
- TikTok/Yandex могут возвращать limited/`not_available` для campaigns/metrics;
- production encrypted storage, per-user auth и permissions будут следующим этапом.

## 9. Закрытие demo

Итоговая фраза:

> К концу beta мы хотим подтвердить главный сценарий: рекламный аккаунт подключается через dashboard/OAuth, AI-клиент видит hosted MCP tools, read-запросы работают по реальным данным, а опасные действия остаются только в preview.

После demo заполнить [BETA_ACCEPTANCE_CHECKLIST_RU.md](BETA_ACCEPTANCE_CHECKLIST_RU.md) и [GO_NO_GO_RU.md](GO_NO_GO_RU.md).
