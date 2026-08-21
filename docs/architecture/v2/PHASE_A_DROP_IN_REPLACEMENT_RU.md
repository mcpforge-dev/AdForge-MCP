# Phase A: V2 как drop-in replacement для V1

## Решение

HolyMedia MCP v2 развивается как внутренняя замена текущего V1. Новый публичный
hostname, новый DNS и новые OAuth-приложения для V2 не создаются.

Внешний production-контракт сохраняется:

- `https://mcp.holymedia.kz`;
- `/mcp` и существующие MCP discovery/OAuth endpoints;
- Google callback: `/oauth/google/callback`;
- Meta callback: `/oauth/meta/callback`;
- Yandex callback: `/oauth/yandex/callback`;
- TikTok callback: `/oauth/tiktok/callback`;
- Google, Meta, Yandex и TikTok application credentials;
- существующие scopes, permissions и App Review approvals.

V2 internal API может использовать `/api/v1/*`, но provider callbacks не должны
получать этот prefix. В NestJS callback paths явно исключены из global prefix,
поэтому V2 сохраняет внешний V1 callback URL.

## Правило миграции подключений

Рекламные кабинеты не создаются заново. Мигрируются связи и внешние IDs:

```text
V1 user/workspace
  -> V2 user/workspace/membership
V1 connection
  -> V2 ProviderConnection
V1 encrypted credentials
  -> V2 credential vault
V1 selected account mapping
  -> V2 ProviderAccount.enabled + workspace scope
```

Credentials переносятся только внутри migration runtime: расшифровка происходит
в памяти процесса, затем payload сразу шифруется V2 AES-GCM. Plaintext не пишется
на диск, в миграционный отчёт, логи или telemetry.

## Что может потребовать повторного действия пользователя

- browser sessions могут быть отозваны при cutover;
- Google reconnect нужен только если нельзя сохранить refresh token с тем же
  OAuth Client ID или provider smoke не подтверждает миграцию;
- Meta reconnect нужен только при недействительном/отозванном токене либо при
  необходимости выдать отсутствующие permissions;
- MCP/service token может быть перевыпущен при несовместимости формата или
  изменении scope policy.

Повторная регистрация пользователя и создание рекламного кабинета запрещены
как обычный migration path.

## Compatibility boundary

До Phase C V1 остаётся reference implementation и production runtime. В V2
каждый внешний V1 route должен иметь один из статусов:

- `MIGRATED`: реализован в V2 и покрыт parity-тестом;
- `COMPATIBILITY`: внешний route сохранён, внутри направлен на V2 contract;
- `BRIDGED`: временно обслуживается legacy adapter до переноса capability;
- `BLOCKED`: не допускается к cutover.

V1 нельзя удалять, пока остаются `BRIDGED` или `BLOCKED` critical capabilities.

## Ручное подключение Meta

Пока прямой Meta OAuth клиента ожидает доступ к нужным разрешениям, клиент может
создать заявку из dashboard. В заявку передаются только идентификаторы кабинета
и необязательные рабочие сведения; пароли, access token, app secret и другие
секреты сервер отклоняет.

Специалист должен быть приглашён в тот же workspace с ролью `ADMIN` или `OWNER`.
После этого он видит заявку, запускает официальный OAuth через сохранённый
callback `/oauth/meta/callback`, выбирает обнаруженные кабинеты и включает нужные
аккаунты. Выбранный аккаунт добавляется к уже включённым, поэтому повторный выбор
не отключает ранее подключённые кабинеты. Все действия остаются ограничены
workspace и фиксируются в audit log.

Это не обход Meta OAuth: рекламный пользователь сам подтверждает доступ в Meta,
а HolyMedia получает только разрешения и кабинеты, которые вернул Graph API.

## Cutover gates

Перед переключением reverse proxy обязательны:

1. dry-run и повторяемая V1 -> V2 миграция;
2. backup и restore rehearsal;
3. provider read parity на Google и Meta;
4. OAuth callback smoke с существующими URL;
5. MCP tool/service-token parity;
6. tenant isolation и authorization matrix;
7. reports, uploads, background jobs и billing migration checks;
8. blue/green rollback rehearsal.

Production V1 не изменяется во время Phase A и Phase B.
