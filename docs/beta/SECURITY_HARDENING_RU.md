# Security hardening для hosted beta

AdForge MCP остается hosted MCP-сервисом. Клиент подключается к dashboard и hosted MCP endpoint, а не запускает проект локально.

## Access model

Beta-доступ строится вокруг bearer token:

```http
Authorization: Bearer <BETA_TOKEN>
```

Token настраивается на сервере:

```dotenv
AD_MCP_WEB_API_TOKEN=replace-with-strong-beta-token
```

## Public endpoints

Публичными остаются только:

- `GET /` - dashboard shell, сам API внутри требует beta token;
- `GET /health` и `GET /healthz` - lightweight healthcheck;
- `GET /ready` - readiness без секретов;
- `POST /api/auth/forgot-password` - нейтральный password-reset запрос без раскрытия, существует email или нет;
- `POST /api/auth/reset-password` - смена пароля по одноразовому reset token;
- `GET /reset-password` - shell формы нового пароля;
- `GET /uploads/avatars/<file>` - только безопасные avatar image files из контролируемой директории;
- OAuth callback endpoints:
  - `/oauth/meta/callback`;
  - `/oauth/google/callback`;
  - `/oauth/tiktok/callback`;
  - `/oauth/yandex/callback`.

OAuth callbacks публичные, потому что провайдер должен вернуть пользователя на них. Они защищены signed state, TTL и одноразовым state id.

## Protected endpoints

Большинство `GET /api/*` и `POST /api/*` требуют beta token или email-session. Исключения перечислены в Public endpoints и не раскрывают секреты:

- hosted connections;
- OAuth authorize-url/pending/select;
- disconnect/import-local;
- diagnostics;
- platform/account/campaign/metrics responses;
- Meta dashboard/API endpoints;
- preview endpoints.
- profile endpoints (`GET/PUT /api/profile`, `POST /api/profile/change-password`, `POST /api/profile/avatar`) требуют email-session и same-origin для изменяющих действий.

Hosted MCP endpoint `/mcp` тоже должен требовать bearer token.

## OAuth state protection

OAuth state:

- генерируется через случайный `jti`;
- подписывается HMAC;
- содержит provider, issued_at и redirect_uri;
- имеет TTL;
- сохраняется в server-side connection store;
- сжигается после первого callback;
- callback с invalid/tampered/expired/reused state отклоняется.

Pending selection:

- создается только после успешного OAuth callback;
- использует unpredictable `pending_id`;
- доступна только через закрытый `/api/hosted/oauth/<provider>/pending`;
- очищается после успешного account selection.

## Secret redaction

Секреты не должны попадать в:

- API responses;
- diagnostics;
- logs;
- exception messages;
- frontend;
- docs examples;
- tests snapshots.

Редактируются:

- `access_token`;
- `refresh_token`;
- `client_secret`;
- `app_secret`;
- `developer_token`;
- `Authorization` / bearer values;
- OAuth `code` в error/log text.

## Password reset и avatars

Password reset:

- raw reset token отправляется только по email;
- в базе хранится hash reset token;
- token одноразовый и имеет TTL;
- ответ `forgot-password` не раскрывает, существует email или нет;
- SMTP password не возвращается diagnostics/capabilities.

Avatar upload:

- разрешены только JPG/PNG/WEBP;
- проверяются extension, MIME type и magic bytes;
- оригинальное имя файла не используется;
- physical upload path не возвращается клиенту;
- SVG/HTML/JS/исполняемые файлы запрещены.

## Preview-only protection

Для beta:

```dotenv
AD_MCP_PREVIEW_ONLY=true
```

Это означает:

- preview tools возвращают `will_apply=false`;
- `commit_preview` возвращает blocked status;
- provider write endpoints не вызываются;
- `/ready` и `/api/diagnostics/security` показывают `preview_only=true`;
- `live_writes_enabled=false`.

## Browser security

Web server выставляет:

- `Cache-Control: no-store`;
- `Pragma: no-cache`;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: no-referrer`;
- `Cross-Origin-Resource-Policy: same-origin`;
- `Permissions-Policy`;
- базовый `Content-Security-Policy`.

CORS для beta: не включать wildcard CORS для sensitive endpoints. Dashboard и API должны работать same-origin через reverse proxy.

## Rate limiting

В приложении нет stateful distributed rate limiter. Для beta используем Nginx-level rate limiting:

- отдельная zone для `/mcp`;
- отдельная zone для `/api/hosted/oauth/`;
- общая zone для dashboard/API.

Пример есть в `deploy/nginx.adforge-mcp.example.conf` и [REVERSE_PROXY_RU.md](REVERSE_PROXY_RU.md).

## Storage permissions

`/var/lib/adforge-mcp/connections.json`:

- хранится вне static/public directories;
- не отдается Nginx;
- не коммитится;
- содержит OAuth secrets;
- должен быть доступен только service user.

Рекомендуемые права:

```bash
sudo chown -R adforge:adforge /var/lib/adforge-mcp
sudo chmod 750 /var/lib/adforge-mcp
sudo chmod 600 /var/lib/adforge-mcp/connections.json
```

## Security diagnostics

Endpoint:

```http
GET /api/diagnostics/security
Authorization: Bearer <BETA_TOKEN>
```

Показывает без секретов:

- `beta_token_configured`;
- `api_auth_required`;
- `preview_only`;
- `live_writes_enabled`;
- `storage_path_configured`;
- `connections_storage_accessible`;
- `public_mcp_url_configured`;
- `oauth_provider_env_present`;
- `dangerous_debug_mode_enabled`;
- `secrets_redacted`;
- `tokens_returned`.

Capabilities endpoint:

```http
GET /api/beta/capabilities
Authorization: Bearer <BETA_TOKEN>
```

Он возвращает beta-scope, MCP URL, список tools и preview-only posture без секретов. Подробнее: [BETA_CAPABILITIES_RU.md](BETA_CAPABILITIES_RU.md).

Перед beta demo дополнительно пройти [END_TO_END_BETA_VALIDATION_RU.md](END_TO_END_BETA_VALIDATION_RU.md) и [GO_NO_GO_RU.md](GO_NO_GO_RU.md).

## Known beta limitations

- Один beta token - это beta access model, не production user auth.
- JSON storage не является production-grade encrypted DB.
- Rate limiting на уровне Nginx, не application cluster-level.
- Нет полноценной tenant isolation.
- Перед production нужны per-user auth, encrypted storage, token rotation, audit UI и scoped permissions.
