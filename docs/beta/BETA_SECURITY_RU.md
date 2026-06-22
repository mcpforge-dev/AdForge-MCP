# Beta security

HolyMedia MCP beta построен вокруг безопасной hosted-модели: сервер и секреты находятся на VPS/WPS, клиент подключает только dashboard и hosted MCP endpoint.

Подробный hardening checklist: [SECURITY_HARDENING_RU.md](SECURITY_HARDENING_RU.md).

## Preview-only mode

В beta реальные write-действия отключены.

```env
AD_MCP_PREVIEW_ONLY=true
```

Это означает:

- dangerous tools возвращают `mode=preview_only`;
- dangerous tools возвращают `will_apply=false`;
- `commit_preview` блокируется;
- provider write endpoints не вызываются;
- preview показывает expected result, но ничего не применяет в рекламном кабинете.

## Beta token

Web API и hosted MCP endpoint закрываются beta token:

```env
AD_MCP_WEB_API_TOKEN=change-this-beta-token
```

Клиент передает токен как:

```http
Authorization: Bearer <BETA_TOKEN>
```

В production-like окружении без `AD_MCP_WEB_API_TOKEN` API должен быть заблокирован.

Все `GET /api/*`, `POST /api/*` и hosted MCP endpoint закрыты beta token. Публичными остаются только dashboard shell, `/health`, `/ready` без секретов и OAuth callback endpoints со state protection.

## Секреты

Нельзя коммитить:

- `.env`;
- `ads_config.yaml`;
- `tokens/connections.json`;
- `access_token`;
- `refresh_token`;
- `client_secret`;
- `app_secret`;
- `developer_token`.

OAuth credentials и provider secrets должны приходить только из env на сервере.

## Что скрывается в API

Diagnostics и dashboard не должны показывать:

- полный access token;
- полный refresh token;
- полный client secret;
- полный app secret;
- Google Ads developer token;
- beta token.

Env variables показываются только как `present` или `missing`.

## Connection storage

`tokens/connections.json` - beta storage. Он нужен для быстрой beta-итерации и хранит OAuth connections runtime-уровня.

Для production потребуется:

- database-backed encrypted storage;
- user isolation;
- per-user/per-tenant access control;
- rotation и revoke flow;
- audit trail для token operations.

## Logs

В logs не должны попадать raw tokens или secrets. Ошибки OAuth/provider API должны редактироваться перед выводом наружу.

OAuth state подписывается, имеет TTL и используется одноразово. Pending selection доступен только через закрытый `/api/hosted/oauth/<provider>/pending`.

## Password reset и профиль

Восстановление пароля работает через email:

- `POST /api/auth/forgot-password` возвращает нейтральный ответ и не раскрывает, существует email или нет;
- reset token генерируется как raw value только для письма, в базе хранится только hash;
- reset token имеет TTL (`AD_MCP_PASSWORD_RESET_TTL_MINUTES`) и используется один раз;
- после успешной смены пароля старые reset tokens и активные sessions пользователя инвалидируются;
- SMTP secrets не возвращаются в API и не должны попадать в логи.

Avatar upload:

- принимает только JPG, PNG и WEBP;
- проверяет расширение, MIME type и magic bytes;
- не использует оригинальное имя файла как путь;
- хранит файлы в контролируемой директории `AD_MCP_PROFILE_UPLOAD_DIR`;
- не принимает SVG/HTML/JS/исполняемые файлы;
- возвращает только безопасный `avatar_url`, без physical server path.

## Security diagnostics

Проверить posture можно через:

```http
GET /api/diagnostics/security
Authorization: Bearer <BETA_TOKEN>
```

Endpoint показывает только статусы, например `beta_token_configured`, `preview_only`, `live_writes_enabled=false`, `connections_storage_accessible`, `oauth_provider_env_present`.

## Preview response

Preview должен содержать:

- `platform`;
- `account_id`;
- `object_type`;
- `object_id`;
- `action`;
- `current_value`;
- `requested_value`;
- `expected_result`;
- `risk_level`;
- `will_apply=false`;
- причину, что beta работает в preview-only mode.

Если текущее состояние невозможно прочитать, preview не должен выдумывать current value.

## Known beta risks

- JSON storage не является production database.
- Multi-tenant isolation еще не финализирован.
- Реальные provider credentials требуют ручной проверки на live аккаунтах.
- TikTok/Yandex read support ограничен, поэтому нельзя обещать live campaigns/metrics до отдельной реализации.
