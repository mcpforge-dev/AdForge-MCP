# HolyMedia MCP v2: Phase 0.5

## Статус

Phase 0.5 выполнена для текущего v1 без переписывания бизнес-функций и без изменения `preview_only`. Production и staging прошли health/readiness smoke-проверки после security rollout.

Финальная точка остановки перед Phase 1: **не пройдена**. Причина — исходный код Hermes не найден ни в актуальном репозитории, ни в доступной истории, ни в локальных копиях, ни на VPS. Создавать Hermes заново по памяти нельзя.

## 1. Reconciliation Hermes

Проверены:

- текущий репозиторий `mcp-for-ads-v2`, все локальные ветки и история;
- локальные рабочие каталоги HolyMedia MCP, Desktop, Downloads и пользовательская директория Hermes;
- старый VPS checkout `/opt/mcp-for-ads`, его ветка и история;
- systemd units и deployment-конфигурация;
- production database metadata.

Результат:

- исходники `hermes_agent`, Telegram gateway, polling и Hermes tests отсутствуют;
- в Git history нет Hermes/Telegram-коммитов;
- старый `/opt/mcp-for-ads` не содержит Hermes и его unit отключён;
- в production database есть активный read-only service-token, ранее названный для Hermes, но самого Hermes runtime рядом нет;
- актуальный Hermes source commit/repository/branch установить невозможно по доступным данным.

Это объясняет, почему Phase 0 не включил Hermes в карту runtime: текущий аудит проводился по доступному репозиторию и фактическому production runtime, а прежний Hermes source в них отсутствует.

## 2. Production/source reconciliation

| Возможность | Источник в текущем репозитории | Production commit |
|---|---|---|
| Google Ads OAuth, accounts, campaigns, reports | `src/ad_mcp/providers/google_ads/`, `src/ad_mcp/web/` | `042d667` |
| Meta Ads OAuth, `ads_read`, Business/Page read tools, guarded writes | `src/ad_mcp/providers/meta_ads/`, `src/ad_mcp/web/meta_oauth.py` | `042d667` |
| Workspace-scoped connection storage | `src/ad_mcp/core/connection_store.py` | `042d667` |
| MCP service tokens and access policy | `src/ad_mcp/web/auth_store.py`, `src/ad_mcp/mcp_auth.py`, `src/ad_mcp/runtime_context.py` | `042d667` |
| MCP HTTP transport and tool registration | `src/ad_mcp/server.py`, `src/ad_mcp/http_server.py` | `042d667` |
| Reports and document/PDF export | `src/ad_mcp/reporting/`, `src/ad_mcp/web/monthly_ads_report.py` | `042d667` |

На production зарегистрировано 135 MCP tools. В текущей кодовой базе присутствуют Meta App Review инструменты и существующий `ads_read` сценарий. Hermes runtime source среди этих 135 tools не обнаружен.

## 3. Исправления безопасности v1

### Provider/OAuth credentials

Добавлена envelope encryption at rest на базе Fernet с ключом, который хранится только во внешнем env-файле deployment. Ключ не хранится в Git, `connections.json`, database, frontend или логах.

Добавлены:

- `CredentialCipher` с версионированным ciphertext;
- server-side decrypt только в connection store;
- миграция `scripts/migrate_connection_credentials.py`;
- encrypted backup до записи;
- запрет legacy plaintext после миграции;
- тесты encrypted storage, migration и отсутствия plaintext.

Результат миграции production: `194` credential records переведены в encrypted storage. После миграции в `connections.json` отсутствуют настоящие поля plaintext `credentials`, `access_token`, `refresh_token`, `app_secret`, `client_secret`, `developer_token`. Слово `credentials_encrypted` является служебным именем ciphertext-поля и не содержит plaintext credentials.

### Legacy global MCP token

Глобальный bearer больше не даёт unscoped доступ к workspace dashboard/API. Для MCP legacy path токен отключён по умолчанию. Backward-compatible режим возможен только при явной конфигурации workspace и provider/account allowlist; без этой привязки токен отклоняется.

Browser data routes требуют workspace session. Operator diagnostics routes отделены от tenant data routes.

### Service-token lifecycle

Для `mcp_service_tokens` добавлено поле `expires_at` и индекс. Создание новых токенов получает bounded TTL, а проверка отклоняет истёкшие/некорректные токены и фиксирует их revoke. Существующие активные токены не инвалидировались вслепую: один legacy active token получил 30-дневный migration grace period. Scope, workspace и account allowlist сохраняются обязательными.

Существующие поля `created_at`, `last_used_at`, `revoked_at`, scope и restrictions сохранены и используются server-side.

## 4. Staging rollout

Перед изменением созданы защищённые backup-файлы staging DB, storage и env. Ключ staging отдельный от production.

- staging commit: `042d667c7b587c3d79954f9ed1f9bb651e76a09f`;
- services: `adforge-mcp-staging-web`, `adforge-mcp-staging-http` active;
- `/health`: `200`;
- `/ready`: `200`;
- `/mcp` без токена: `401`;
- `preview_only` не изменён;
- staging plaintext migration завершена, legacy plaintext отключён.

## 5. Production rollout

Перед rollout созданы защищённые backup-файлы production DB, storage и env. Live был обновлён fast-forward на security commit и перезапущены только `adforge-mcp-web` и `adforge-mcp-http`.

- production commit: `042d667c7b587c3d79954f9ed1f9bb651e76a09f`;
- services active;
- `/health`: `200`;
- `/ready`: `200`;
- `/mcp` без токена: `401`;
- production `connections.json`: `194` encrypted records, plaintext credential fields отсутствуют;
- `AD_MCP_CREDENTIALS_ALLOW_LEGACY_PLAINTEXT=false`;
- legacy global MCP token disabled;
- `preview_only` и запрет широких writes сохранены.

## 6. Read-only smoke

Проверка выполнялась server-side на расшифрованных production connections без вывода credential material.

- Google Ads: live campaign read успешно выполнен через `google_ads_api`, один активный customer account вернул реальные campaign rows;
- Meta Ads: live campaign read успешно выполнен для `act_1423247033195473` через `meta_marketing_api`, возвращены реальные rows;
- encrypted connection loading проверен для production workspaces;
- один старый Google account вернул штатную ошибку отключённого/deactivated customer account, что является состоянием внешнего рекламного кабинета, а не ошибкой encryption migration;
- service-token metadata подтвердил `active=1`, `expires_at` заполнен, `last_used_at` заполнен.

Полный повторный Meta Business/Page/Instagram App Review сценарий после миграции credentials не выполнялся в рамках этой фазы; его следует повторить отдельным staged smoke после восстановления Hermes/source reconciliation. Это не подменялось mock-данными.

## 7. Regression и security tests

Запущено:

- `235 passed`;
- Python `compileall` для `src` и `scripts`;
- `node --check src/ad_mcp/web/static/app.js`;
- `git diff --check`;
- encrypted credential storage и migration tests;
- workspace/account isolation tests;
- legacy token scope/allowlist tests;
- read-only token write denial;
- revoked/expired service-token tests;
- MCP HTTP auth regression tests;
- existing OAuth/connection store regression tests.

Секреты не добавлены в commit и не выводились в отчёт. В Git tracked-файлах отсутствуют пользовательские OAuth/API/token values.

## 8. Оставшиеся блокеры и риски

1. Hermes source/runtime не найден. Нужен исходный repository, branch, archive или другой подтверждённый source location до Phase 1.
2. Один старый Google customer account деактивирован во внешнем кабинете и требует отдельной проверки у владельца аккаунта.
3. Внешний penetration test, DAST, restore rehearsal и полный ASVS Level 2 sign-off относятся к последующим QA/security фазам и здесь не заявляются выполненными.
4. Активный legacy service token нужно ротировать до окончания migration grace period, когда будет найден и проверен реальный Hermes client.

## 9. Решение STOP POINT

Текущий v1 security rollout выполнен, Critical/High finding по plaintext provider credentials, global unscoped token path и non-expiring service token закрыты в коде и проверены тестами. Но условие полного reconciliation не выполнено из-за отсутствующего Hermes source.

**Phase 1 не начинать.** Сначала предоставить подтверждённый Hermes source или явно принять решение о его восстановлении отдельной задачей после технического согласования.
