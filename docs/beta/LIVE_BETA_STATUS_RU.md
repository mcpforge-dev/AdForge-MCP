# Live beta status HolyMedia MCP

Дата обновления: 2026-06-12 (вечерняя сессия, проверки выполнены напрямую на VPS).

Маркеры статусов:

- `verified_live` — проверено напрямую на live VPS/URL в эту сессию;
- `not_verified` — не проверено;
- `needs_credentials` — заблокировано отсутствием provider credentials в live env;
- `needs_provider_dashboard_access` — требуется доступ к кабинету провайдера (Meta App Dashboard / Google Cloud Console).

## Dashboard UI

- 2026-06-17: live UI обновлён до client dashboard onboarding (`6a3ec49`) и затем расширен account-функциями: профиль, никнейм, avatar upload, смена пароля и backend-ready SMTP password reset. Diagnostics скрыта из клиентской навигации; backend diagnostics остаётся для operator/admin. Для реальной отправки reset email нужно добавить SMTP env в `/etc/adforge-mcp/adforge-mcp.env` и перезапустить services.
- 2026-06-13: web dashboard полностью переработан (UI/UX redesign, без изменений backend/OAuth/security). Структура: token gate → `Overview` → `Connections` → `Diagnostics`, постоянный бейдж `Preview-only: ON`, честные статусы платформ (`Credentials missing` / `Ready to connect` / `Select accounts` / `Connected` / `Reconnect required`, `Limited beta` для TikTok/Yandex), блок `Connect to MCP client` с `Copy MCP URL`, raw JSON только в accordion. API contract не менялся.

## Live deployment

- Live URL: `https://77.240.38.131.sslip.io` — `verified_live`.
- Deployed commit: `23a572d Harden beta readiness for live OAuth stage` — `verified_live` (обновлено с `d6602c4` fast-forward pull в эту сессию, конфликтов нет).
- Repo на VPS: `/opt/adforge-mcp`, владелец `HolyMedia` — `verified_live`.
- Live env: `/etc/adforge-mcp/adforge-mcp.env`, beta token present (64 символа) — `verified_live` (значения не выводились).
- Storage: `/var/lib/adforge-mcp/connections.json` — `verified_live`; права исправлены с `644` на `600`, владелец `adforge:adforge`.
- Services: `adforge-mcp-web`, `adforge-mcp-http`, `nginx` — все `active/running` после рестарта — `verified_live`.
- Порты: `127.0.0.1:8765` (web), `127.0.0.1:8766` (MCP HTTP) слушают — `verified_live`.

## Endpoint checks (все `verified_live`)

- `GET /` (dashboard) → `200`.
- `GET /health` → `{"status": "ok"}`.
- `GET /ready` → `status=ready`, `environment=beta`, token required+configured, `preview_only=true`, storage ok, MCP transport available; секретов в ответе нет.
- `GET /api/diagnostics` без token → `401`; с token → `status=needs_setup` (аккаунты не подключены — честно).
- `POST /mcp` без token → `401`; с token → транспорт отвечает (400 на `tools/list` без MCP session — нормально для streamable HTTP).
- `GET /tokens/connections.json` → `403`; путь backup-директории → `404` (приватные пути закрыты).

## Strict smoke (`verified_live`)

`scripts/smoke_hosted_beta.py --strict-deploy` на VPS: **все 18 checks OK**, включая новые строгие проверки `beta_token_configured` и `secrets_redacted`.

## Security diagnostics (`verified_live`)

`/api/diagnostics/security`:

- `api_auth_required=true`;
- `beta_token_configured=true`;
- `preview_only=true`;
- `live_writes_enabled=false`;
- `tokens_returned=false`;
- `secrets_redacted=true`;
- `dangerous_debug_mode_enabled=false`;
- `cors_policy=same-origin`, `cache_control=no-store`.

Journal logs (`adforge-mcp-web`, `adforge-mcp-http`, последние 300 строк): **0 совпадений** по маркерам `access_token= / refresh_token= / client_secret= / app_secret= / developer_token= / Bearer` — `verified_live`.

## OAuth status по платформам (`verified_live`, presence из server env)

| Платформа | Env credentials | Статус |
| --- | --- | --- |
| Meta Ads | `AD_MCP_META_OAUTH_APP_ID=missing`, `AD_MCP_META_OAUTH_APP_SECRET=missing` | `needs_credentials` |
| Google Ads | `CLIENT_ID=missing`, `CLIENT_SECRET=missing`, `DEVELOPER_TOKEN=missing`, `LOGIN_CUSTOMER_ID=missing` | `needs_credentials` |
| TikTok Ads | `APP_ID=present`, `APP_SECRET=present` | `not_connected` — env есть, live OAuth не проходил |
| Yandex Direct | `CLIENT_ID=present`, `CLIENT_SECRET=present` | `not_connected` — env есть, live OAuth не проходил |

## Credential discovery на VPS (2026-06-13, значения не выводились)

Где искал: `/opt`, `/home/ubuntu`, `/root`, `/etc/adforge-mcp`, `/var/lib/adforge-mcp`, `/var/backups/adforge-mcp` — по именам файлов (`.env*`, `ads_config.yaml`, `google-ads.yaml`, `client_secret*.json`, `*credentials*.json`) и по ключам Meta/Google.

Найдено в предшественнике `mcp-for-ads` (Meta-only console, не HolyMedia):

- `/opt/mcp-for-ads/.env` — **git-tracked**, в истории (commit `abfe8be`), remote `github.com/StanislavDesginer/mcp-for-ads-v2`.
- `/home/ubuntu/projects/mcp-for-ads/.env` — untracked, remote `github.com/StanislavDesigner/mcp-for-ads`.
- `ads_config.yaml` в обеих копиях.

Содержимое (только тип/наличие, без значений):

- **Meta: 3 разных app** (Varikoza Net, Interna Clinic, Pallada) — у каждого реальный `app_id` (16-значный) + реальный `app_secret` (32 симв.) + long-lived user `access_token` (формат `EAA...`). Это **app credentials** старой per-account модели, не единый hosted-OAuth app.
- **Google: пусто везде** — `oauth_client_id`/`oauth_client_secret`/`developer_token`/`login_customer_id`/`refresh_token` все EMPTY; `client_secret.json` и `google-ads.yaml` не найдены.
- TikTok/Yandex app credentials в этих файлах не заданы (отдельно от live env, где они present).

**Решение по миграции: НЕ перенесено в live env.** Причины:

1. Три разных Meta app — выбор, какой app становится OAuth-шлюзом hosted-сервиса, это бизнес-решение пользователя, не угадывается.
2. `app_secret` лежат в **git-tracked файле с remote** → считаются **компрометированными** → перед production-использованием нужен **rotate** в Meta App Dashboard. Перенос скомпрометированного секрета в live OAuth = регресс безопасности.
3. Redirect URI `https://77.240.38.131.sslip.io/oauth/meta/callback` в конкретном Meta app нельзя проверить/настроить без доступа к Meta App Dashboard.
4. Найденные `access_token` — это user-токены, не OAuth app credentials; для hosted OAuth не используются.

### SECURITY ISSUE (high)

Реальные Meta `app_secret` (×3) и long-lived `access_token` (×3) закоммичены в git-репозиторий `mcp-for-ads-v2` с remote на GitHub. Действия:

- считать эти 3 app secrets и 3 access tokens **компрометированными**;
- **rotate** app secret каждого Meta app в Meta App Dashboard (Settings → Basic → Reset);
- инвалидировать/перевыпустить access tokens;
- удалить `.env` из tracked файлов репозитория (`git rm --cached .env`, добавить в `.gitignore`) и почистить историю при необходимости.

Репозиторий **HolyMedia MCP** секреты НЕ трекает (`git ls-files` чисто) — проблема только в legacy `mcp-for-ads`.

## OAuth authorize-url status

- Meta authorize-url: **not generated** — `AD_MCP_META_OAUTH_APP_ID/SECRET` отсутствуют в live env (callback честно отвечает «not configured»).
- Google authorize-url: **not generated** — Google env отсутствует.
- Миграция найденных Meta creds не выполнялась (см. выше), поэтому статус authorize-url не изменился.

- Connected platforms: 0. Connected accounts: 0.
- Live OAuth не проходил ни для одной платформы. Fake-данные не создавались.

## Read tools / metrics status

- Диагностические tools (`run_diagnostics`, `list_connected_platforms`, `list_ad_accounts`, `get_account_status`, `run_connection_diagnostics`) работают и честно возвращают `needs_setup`/`not_connected` — подтверждено через `/api/diagnostics` и capabilities (`verified_live`).
- `list_campaigns`, `get_campaign_statuses`, `get_basic_metrics` — вернут реальные данные только после подключения аккаунта; до этого `not_available`. Проверка на реальном аккаунте — `needs_credentials`.
- MCP tools перечитывают connection store при каждом вызове: после OAuth-подключения рестарт `adforge-mcp-http` не обязателен.

## Preview-only status

- `preview_only=true`, `live_writes_enabled=false` на live — `verified_live`.
- `will_apply=false` / `commit_preview=blocked` закреплены unit-тестами и локальным smoke; проверка на реальном `campaign_id` — `needs_credentials` (нет подключённого аккаунта).

## Backup status

- Storage права: `600 adforge:adforge` — `verified_live` (исправлено в эту сессию).
- Backups в `/var/backups/adforge-mcp/` (директория `750`, не публичная — `verified_live`):
  - `connections-20260612-170210.json`;
  - `connections-20260612-185156.json` (создан в эту сессию, `600`).

## Что нужно для завершения этапа 12 (live OAuth Meta / Google)

### Meta Ads — `needs_provider_dashboard_access`

Примечание: в legacy `mcp-for-ads` есть 3 готовых Meta app (Varikoza/Interna/Pallada), но их секреты git-скомпрометированы (см. SECURITY ISSUE). Можно переиспользовать один из этих app для hosted OAuth **только после rotate секрета**.

1. Выбрать один Meta app под hosted OAuth (или создать новый Business app).
2. **Rotate** его `app_secret` (Meta App Dashboard → Settings → Basic → Reset), если используется legacy app.
3. В Meta App Dashboard: Facebook Login → Settings → Valid OAuth Redirect URIs: `https://77.240.38.131.sslip.io/oauth/meta/callback`.
4. Permissions: `ads_read`, `business_management`; у пользователя — доступ к рекламному кабинету (для dev mode — роль в app).
5. В `/etc/adforge-mcp/adforge-mcp.env` добавить: `AD_MCP_META_OAUTH_APP_ID`, `AD_MCP_META_OAUTH_APP_SECRET` (свежий, только на сервере).
6. `sudo systemctl restart adforge-mcp-web adforge-mcp-http`.
5. Dashboard → Connections → Connect Meta Ads → OAuth → выбрать аккаунты → Save → Run diagnostics.
6. MCP: `list_ad_accounts`, `list_campaigns platform=meta_ads`, `get_basic_metrics` за 7 дней.

### Google Ads — `needs_provider_dashboard_access`

1. Google Cloud Console: OAuth Client (Web application), Authorized redirect URI: `https://77.240.38.131.sslip.io/oauth/google/callback`.
2. OAuth consent screen настроен; в testing mode добавить test user; Google Ads API включён; Developer Token из Google Ads API Center.
3. В `/etc/adforge-mcp/adforge-mcp.env` добавить: `AD_MCP_GOOGLE_OAUTH_CLIENT_ID`, `AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET`, `AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN`, опционально `AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID` (цифры без дефисов).
4. `sudo systemctl restart adforge-mcp-web adforge-mcp-http`.
5. Dashboard → Connections → Connect Google Ads → OAuth → выбрать customer accounts → Save → Run diagnostics.
6. MCP: `list_campaigns platform=google_ads`, `get_basic_metrics platform=google_ads`.

### После подключения (обе платформы)

1. Strict smoke на VPS → все checks ok.
2. Журналы на секреты → 0 совпадений.
3. Preview-проверка на реальном `campaign_id`: `preview_change_campaign_budget`, `preview_pause_campaign`, `preview_resume_campaign` → `will_apply=false`; `commit_preview` → `blocked`.
4. Backup `connections.json` (см. runbook) и обновление этого документа.

## Known limitations

- Реальные write-действия отключены (preview-only) — осознанное ограничение beta.
- TikTok/Yandex: env present, но live OAuth не проходил; campaigns/metrics могут возвращать `not_available`.
- Connection store — JSON-файл без межпроцессных блокировок; для одного beta-оператора приемлемо.
- `sslip.io` — временный домен; для продакшена нужен собственный домен и постоянный cert.

## Готовность к demo

Готово сейчас (`verified_live`):

- hosted dashboard за beta token gate;
- hosted MCP endpoint c bearer auth;
- strict smoke полностью зелёный;
- security posture полностью соответствует ожиданиям;
- preview-only guardrails;
- честные `needs_setup`/`not_connected` статусы;
- storage с корректными правами и свежим backup.

Блокеры demo с реальными рекламными данными:

1. Meta OAuth credentials в live env — `needs_credentials`. На VPS найдены 3 legacy Meta app, но их секреты git-скомпрометированы → нужен rotate перед использованием + выбор одного app + whitelisting redirect URI.
2. Google OAuth credentials + developer token в live env — `needs_credentials` (ничего не найдено на VPS).
3. Live OAuth + выбор аккаунтов в dashboard — после п.1/п.2.
4. Read tools/metrics и preview-only на реальном аккаунте — после п.3.

Дата последней проверки credential discovery: 2026-06-13.
