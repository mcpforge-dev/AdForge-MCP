# HolyMedia MCP SaaS foundation

Этот документ фиксирует первый безопасный шаг перехода от beta access dashboard к SaaS-flow.

## Что реализовано в foundation

- Публичная главная страница на `/`.
- Modal входа и регистрации по email/password.
- Базовый клиентский кабинет на `/app`.
- Защищенная админская оболочка на `/admin`.
- Backend endpoints `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- Admin endpoints `/api/admin/users`, `/api/admin/users/status`, `/api/admin/users/role`, `/api/admin/diagnostics`.
- DB schema foundation для `users`, `workspaces`, `workspace_members`, `user_sessions`, `mcp_access_tokens`, `platform_connections`, `selected_ad_accounts`, `oauth_states`, `audit_events`.
- Password hashing через PBKDF2-HMAC-SHA256.
- Session token hash в базе, raw session token только в HttpOnly cookie.
- CLI `scripts/create_admin_user.py` для initial admin без хардкода пароля.
- Старый `AD_MCP_WEB_API_TOKEN` оставлен как fallback для hosted beta API, MCP smoke и internal/operator сценариев.

## База данных

Live beta должна использовать PostgreSQL через `AD_MCP_DATABASE_URL`.

SQLite fallback допустим только для local dev и unit-тестов. Если `AD_MCP_DATABASE_URL` не задан, сервис использует локальный fallback:

```text
sqlite:///tokens/adforge_auth.db
```

Для PostgreSQL нужно установить optional dependency:

```bash
pip install -e ".[postgres]"
```

или:

```bash
pip install "psycopg[binary]>=3.2"
```

ClickHouse не используется для users/auth/sessions.

## Новые env variables

- `AD_MCP_DATABASE_URL`
- `AD_MCP_AUTH_ENABLED`
- `AD_MCP_AUTH_SESSION_COOKIE_NAME`
- `AD_MCP_AUTH_SESSION_TTL_HOURS`
- `AD_MCP_AUTH_SECURE_COOKIES`
- `AD_MCP_AUTH_ALLOW_PUBLIC_REGISTRATION`
- `AD_MCP_AUTH_REGISTRATION_CODE`
- `AD_MCP_INITIAL_ADMIN_EMAIL`
- `AD_MCP_INITIAL_ADMIN_PASSWORD` только для one-time CLI/bootstrap, не коммитить

## Initial admin

Рекомендуемый email первого администратора:

```text
listok.2004@list.ru
```

Пароль не хардкодить и не коммитить.

Создание initial admin:

```bash
export AD_MCP_DATABASE_URL="postgresql://adforge_user:CHANGE_ME@127.0.0.1:5432/adforge_mcp"
export AD_MCP_INITIAL_ADMIN_EMAIL="listok.2004@list.ru"
python scripts/create_admin_user.py
```

Пароль вводится интерактивно. Если нужен автоматизированный one-time bootstrap на VPS, можно временно задать `AD_MCP_INITIAL_ADMIN_PASSWORD` только в shell/session или protected env, не в git.

## Что осталось fallback/beta

- OAuth connections все еще читаются из текущего `tokens/connections.json` / `/var/lib/adforge-mcp/connections.json`.
- Connections пока не привязаны к user/workspace.
- Hosted MCP `/mcp` пока принимает старый bearer fallback.
- User-specific MCP tokens будут следующим отдельным этапом.
- MCP token UI показывает placeholder, raw token не генерируется в этом этапе.
- Rate limiting, CSRF hardening и audit events для admin actions нужно добавить следующим security pass.

## Следующие безопасные этапы

1. Настроить PostgreSQL на VPS, применить schema foundation и создать initial admin.
2. Добавить user-specific MCP token create/revoke/list: raw token показывать один раз, хранить только hash.
3. Перевести `/mcp` на user-specific bearer tokens с fallback для internal smoke.
4. Сделать migration/dual-read plan для `connections.json`, затем связать OAuth connections с workspace/user.
5. Расширить admin panel: user detail, connection status, OAuth readiness, audit events.
6. Добавить rate limiting login/register, CSRF token для cookie POST endpoints и более строгие security headers.

## Ручная проверка foundation

1. Открыть `/` и проверить публичную главную страницу.
2. Нажать `Регистрация`, создать пользователя.
3. Проверить, что после регистрации открывается `/app`.
4. Выйти и войти заново по email/password.
5. Создать initial admin через CLI.
6. Войти под admin и открыть `/admin`.
7. Проверить список пользователей.
8. Проверить, что обычный user не видит `/admin`.
9. Убедиться, что `/api/beta/capabilities` работает через session cookie и через старый bearer fallback.
10. Убедиться, что `/mcp`, OAuth flows, preview-only и `connections.json` не менялись этим этапом.
