# Staging-среда HolyMedia MCP

Этот runbook описывает отдельную staging-среду для проверки изменений перед выкладкой на live `https://mcp.holymedia.kz`.

Главное правило: staging не использует live env, live БД, live `connections.json`, live uploads, live logs, live OAuth tokens и production credentials. Все реальные write-действия в рекламных кабинетах остаются отключенными через `AD_MCP_PREVIEW_ONLY=true`.

## Выбранная архитектура

| Компонент | Live | Staging |
| --- | --- | --- |
| Public URL | `https://mcp.holymedia.kz` | `https://staging-mcp.holymedia.kz` |
| Project path | `/opt/adforge-mcp` | `/opt/adforge-mcp-staging` |
| Env file | `/etc/adforge-mcp/adforge-mcp.env` | `/etc/adforge-mcp/adforge-mcp-staging.env` |
| Web service | `adforge-mcp-web` | `adforge-mcp-staging-web` |
| MCP service | `adforge-mcp-http` | `adforge-mcp-staging-http` |
| Web port | `127.0.0.1:8765` | `127.0.0.1:18765` |
| MCP port | `127.0.0.1:8766` | `127.0.0.1:18766` |
| Database | `adforge_mcp` | `adforge_mcp_staging` |
| OAuth storage | `/var/lib/adforge-mcp/connections.json` | `/var/lib/adforge-mcp-staging/connections.json` |
| Uploads | `/var/lib/adforge-mcp/uploads` | `/var/lib/adforge-mcp-staging/uploads` |
| Audit log | `/var/log/adforge-mcp/audit.jsonl` | `/var/log/adforge-mcp-staging/audit.jsonl` |
| Session cookie | `adforge_session` | `adforge_staging_session` |

## Что означает копия live 1:1

Функциональная копия 1:1 означает одинаковые commit приложения, схему БД,
версии runtime-зависимостей и доступные пользовательские сценарии. Она не
означает использование production БД или перенос рабочих секретов в staging.

Обязательные правила:

- staging checkout совпадает с commit, который фактически запущен на live;
- staging venv собирается по зафиксированному `pip freeze --exclude-editable`
  live, после чего сам проект устанавливается editable из staging checkout;
- схема staging БД копируется из live, но пользователи, сессии, MCP tokens,
  password reset tokens и рекламные подключения по умолчанию не копируются;
- OAuth и SMTP работают только с отдельными staging credentials и callback
  URLs; отсутствие таких credentials является внешним blocker, а не поводом
  копировать production secrets;
- для проверки auth создаются временные staging-пользователи, которые удаляются
  после smoke-теста;
- `AD_MCP_PREVIEW_ONLY=true` остаётся обязательным.

Если владелец данных отдельно разрешил snapshot production БД, restore всё
равно выполняется только в отдельную staging БД. До запуска сервисов из копии
удаляются active sessions, password reset tokens, MCP/OAuth tokens и provider
connections. Подключать staging непосредственно к live БД запрещено.

## Полный backup перед синхронизацией

Кроме env, PostgreSQL и `/var/lib`, в backup нужно включать project-local
runtime storage. Сейчас история AI-анализа хранится в
`<project>/tokens/site_analysis_history.json`.

Минимальный состав закрытого backup:

```text
env/live.env
env/staging.env
db/live.dump
db/staging.dump
storage/live.tar.gz
storage/staging.tar.gz
storage/live-project-tokens.tar.gz
storage/staging-project-tokens.tar.gz
nginx/
systemd/
meta/live-commit.txt
meta/staging-commit.txt
SHA256SUMS
```

Backup directory должна принадлежать root и иметь режим `0700`. Для чтения
закрытого дампа процессом PostgreSQL используйте pipe от root-shell:

```bash
cat "$BACKUP/db/live.dump" \
  | sudo -u postgres pg_restore --schema-only --no-owner --no-privileges \
      --role=adforge_staging_user --dbname=adforge_mcp_staging_next
```

Не передавайте DB URL с паролем аргументом `pg_dump`/`pg_restore` и не печатайте
env в terminal output.

## Безопасная синхронизация БД

Для функционального staging без production-данных используйте временную БД:

1. Создайте `adforge_mcp_staging_next` с владельцем staging DB user.
2. Восстановите в неё только schema из закрытого live dump через root-owned
   pipe.
3. Проверьте набор таблиц и отсутствие пользователей.
4. Остановите только `adforge-mcp-staging-web` и
   `adforge-mcp-staging-http`.
5. Завершите соединения только с двумя staging БД.
6. Переименуйте текущую БД в `adforge_mcp_staging_pre_sync_*`, а временную в
   `adforge_mcp_staging`.
7. Запустите `AuthStore.ensure_schema()` со staging env.
8. Сохраните pre-sync DB до завершения auth, SEO, site analysis, report и MCP
   smoke-проверок.

Такое переключение сокращает простой и оставляет быстрый rollback без операций
над live БД.

## Проверка env без раскрытия значений

Сравнивайте только имена ключей и логические признаки `set/unset`. Значения
секретных переменных выводить нельзя. Структурно staging должен содержать те же
функциональные ключи, что live, но отличаться по назначению для:

- public/MCP URL и портов;
- database URL;
- session cookie name;
- API token и registration code;
- connection store, uploads и audit log paths;
- OAuth client credentials и callback URLs;
- SMTP credentials.

После синхронизации отдельно подтвердите, что DB, storage, uploads, cookies и
tokens различаются, а `preview_only` включён.

Если DNS удобнее вести через `dev-mcp.holymedia.kz`, используйте его вместо `staging-mcp.holymedia.kz` во всех командах и env-переменных.

## DNS

Добавьте DNS A-record:

```text
staging-mcp.holymedia.kz -> 77.240.38.131
```

До настройки DNS certbot и публичные smoke-проверки staging-домена не пройдут.

## Первичная проверка live перед работами

На VPS:

```bash
cd /opt/adforge-mcp
git status
git rev-parse --short HEAD
git log --oneline -5

sudo systemctl status adforge-mcp-web --no-pager
sudo systemctl status adforge-mcp-http --no-pager
sudo systemctl status nginx --no-pager

curl -i https://mcp.holymedia.kz/health
curl -i https://mcp.holymedia.kz/ready
curl -i https://mcp.holymedia.kz/mcp
```

Ожидаемо: `/health = 200`, `/ready = 200`, `/mcp` без token = `401`.

## Создание staging-копии проекта

```bash
sudo mkdir -p /opt/adforge-mcp-staging /etc/adforge-mcp /var/lib/adforge-mcp-staging/uploads /var/log/adforge-mcp-staging /var/backups/adforge-mcp-staging
sudo chown -R adforge:adforge /opt/adforge-mcp-staging /var/lib/adforge-mcp-staging /var/log/adforge-mcp-staging /var/backups/adforge-mcp-staging
sudo chmod 755 /opt/adforge-mcp-staging
sudo chmod 750 /etc/adforge-mcp /var/lib/adforge-mcp-staging /var/log/adforge-mcp-staging /var/backups/adforge-mcp-staging

sudo -u adforge git clone git@github.com:mcpforge-dev/adforge-mcp.git /opt/adforge-mcp-staging
cd /opt/adforge-mcp-staging
sudo -u adforge python3.11 -m venv .venv
sudo -u adforge ./.venv/bin/python -m pip install --upgrade pip
sudo -u adforge ./.venv/bin/python -m pip install -e ".[google,meta,postgres,site-audit]"
sudo -u adforge ./.venv/bin/python -m playwright install chromium
```

`postgres` нужен для `AD_MCP_DATABASE_URL=postgresql://...`; без него регистрация и вход падают на отсутствии `psycopg`. `site-audit` нужен для AI-анализа сайта, Playwright-render и screenshot evidence.

Создайте пустой staging storage:

```bash
sudo -u adforge sh -c 'printf "%s\n" "{\"version\":1,\"connections\":{},\"oauth_pending\":{}}" > /var/lib/adforge-mcp-staging/connections.json'
sudo chmod 600 /var/lib/adforge-mcp-staging/connections.json
```

## Staging database

Рекомендуется отдельная PostgreSQL database, а не отдельная schema в live database:

```bash
sudo -u postgres createuser adforge_staging_user
sudo -u postgres createdb adforge_mcp_staging --owner=adforge_staging_user
sudo -u postgres psql -c "ALTER USER adforge_staging_user WITH PASSWORD 'CHANGE_ME_STRONG_STAGING_PASSWORD';"
```

Пароль не храните в repo и не выводите в отчеты. В staging env используйте отдельный `AD_MCP_DATABASE_URL`.

После заполнения staging env примените auth schema именно к staging DB:

```bash
cd /opt/adforge-mcp-staging
sudo -u adforge bash -lc 'set -a; . /etc/adforge-mcp/adforge-mcp-staging.env; set +a; ./.venv/bin/python - <<PY
from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore
s = Settings(project_root="/opt/adforge-mcp-staging")
store = AuthStore(s)
store.ensure_schema()
print(store.diagnostics()["status"])
PY'
```

Ожидаемо: `ok`. Если schema не создана, email/password регистрация и вход не будут работать.

## Staging env

```bash
sudo cp /opt/adforge-mcp-staging/deploy/adforge-mcp-staging.env.example /etc/adforge-mcp/adforge-mcp-staging.env
openssl rand -hex 32
sudo nano /etc/adforge-mcp/adforge-mcp-staging.env
sudo chown root:adforge /etc/adforge-mcp/adforge-mcp-staging.env
sudo chmod 640 /etc/adforge-mcp/adforge-mcp-staging.env
```

Обязательно проверьте:

- `AD_MCP_ENV=staging`;
- `AD_MCP_PUBLIC_BASE_URL=https://staging-mcp.holymedia.kz`;
- `AD_MCP_MCP_PUBLIC_URL=https://staging-mcp.holymedia.kz/mcp`;
- `AD_MCP_WEB_API_TOKEN` с отдельным staging token;
- `AD_MCP_DATABASE_URL` указывает на `adforge_mcp_staging`;
- `AD_MCP_AUTH_ENABLED=true`;
- `AD_MCP_AUTH_ALLOW_PUBLIC_REGISTRATION` совпадает с live-политикой;
- `AD_MCP_AUTH_REGISTRATION_CODE` задан отдельным staging-кодом, если live требует код регистрации;
- `AD_MCP_AUTH_SESSION_COOKIE_NAME=adforge_staging_session`;
- `AD_MCP_PROFILE_UPLOAD_DIR=/var/lib/adforge-mcp-staging/uploads`;
- `AD_MCP_PREVIEW_ONLY=true`;
- `AD_MCP_CONNECTION_STORE_PATH=/var/lib/adforge-mcp-staging/connections.json`;
- `AD_MCP_AUDIT_LOG_PATH=/var/log/adforge-mcp-staging/audit.jsonl`.

OAuth можно оставить отключенным на staging. Если OAuth нужен, заведите отдельные app/client credentials или явно помеченные staging credentials и добавьте callback URLs:

```text
https://staging-mcp.holymedia.kz/oauth/meta/callback
https://staging-mcp.holymedia.kz/oauth/google/callback
https://staging-mcp.holymedia.kz/oauth/google-search-console/callback
https://staging-mcp.holymedia.kz/oauth/tiktok/callback
https://staging-mcp.holymedia.kz/oauth/yandex/callback
```

## Systemd

```bash
sudo cp /opt/adforge-mcp-staging/deploy/adforge-mcp-staging-web.service.example /etc/systemd/system/adforge-mcp-staging-web.service
sudo cp /opt/adforge-mcp-staging/deploy/adforge-mcp-staging-http.service.example /etc/systemd/system/adforge-mcp-staging-http.service
sudo systemctl daemon-reload
sudo systemctl enable --now adforge-mcp-staging-web
sudo systemctl enable --now adforge-mcp-staging-http
```

Проверка:

```bash
sudo systemctl status adforge-mcp-staging-web --no-pager
sudo systemctl status adforge-mcp-staging-http --no-pager
sudo journalctl -u adforge-mcp-staging-web -n 100 --no-pager
sudo journalctl -u adforge-mcp-staging-http -n 100 --no-pager
```

Logs не должны содержать raw tokens, OAuth secrets, SMTP password или DB password.

## Nginx и HTTPS

```bash
sudo cp /opt/adforge-mcp-staging/deploy/nginx.adforge-mcp-staging.example.conf /etc/nginx/sites-available/adforge-mcp-staging
sudo ln -s /etc/nginx/sites-available/adforge-mcp-staging /etc/nginx/sites-enabled/adforge-mcp-staging
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d staging-mcp.holymedia.kz
sudo nginx -t
sudo systemctl reload nginx
```

Staging Nginx block использует отдельные upstream-порты `18765/18766` и отдельные `limit_req_zone` names, чтобы не конфликтовать с live config.

## Проверка staging

```bash
curl -i https://staging-mcp.holymedia.kz/health
curl -i https://staging-mcp.holymedia.kz/ready
curl -i https://staging-mcp.holymedia.kz/mcp
```

Ожидаемо: `/health = 200`, `/ready = 200`, `/mcp` без token = `401`.

Строгий smoke с token запускайте так, чтобы token не попадал в историю команд и logs:

```bash
cd /opt/adforge-mcp-staging
read -rsp "Staging token: " ADFORGE_MCP_CLIENT_TOKEN; echo
export ADFORGE_MCP_CLIENT_TOKEN
sudo -E -u adforge ./.venv/bin/python scripts/smoke_hosted_beta.py \
  --base-url https://staging-mcp.holymedia.kz \
  --strict-deploy
unset ADFORGE_MCP_CLIENT_TOKEN
```

Ручная проверка:

- главная страница открывается;
- login/logout работают;
- register работает согласно staging auth policy: без кода должен возвращать `registration_code_required`, если задан `AD_MCP_AUTH_REGISTRATION_CODE`; с правильным staging-кодом должен создать session cookie;
- logout через браузерный same-origin запрос возвращает `200`;
- dashboard открывается;
- AI-анализ сайта работает;
- экспорт отчета работает;
- mobile layout не ломается;
- OAuth отключен или явно работает на staging callbacks;
- live `https://mcp.holymedia.kz` продолжает проходить `/health`, `/ready`, `/mcp` без token = `401`.

Минимальная API-проверка auth без вывода registration code:

```bash
cd /opt/adforge-mcp-staging
sudo -u adforge bash -lc 'set -a; . /etc/adforge-mcp/adforge-mcp-staging.env; set +a; ./.venv/bin/python - <<PY
from ad_mcp.settings import Settings
from ad_mcp.web.auth_store import AuthStore
s = Settings(project_root="/opt/adforge-mcp-staging")
d = AuthStore(s).diagnostics()
print(d["status"], d["driver"], d["users"], d["active_sessions"])
PY'
```

Ожидаемо: `ok postgres ...`. Это подтверждает, что staging использует отдельную PostgreSQL DB, а не live user database.

## Деплой на staging

После merge/push нужной ветки в GitHub:

```bash
cd /opt/adforge-mcp-staging
sudo bash scripts/deploy_staging_dashboard.sh origin/main
```

Для проверки отдельной ветки:

```bash
cd /opt/adforge-mcp-staging
sudo bash scripts/deploy_staging_dashboard.sh origin/my-feature-branch
```

Скрипт:

- не трогает `/opt/adforge-mcp`;
- не рестартит live services;
- не печатает env values;
- переводит staging repo на указанный commit;
- обновляет Python package в staging venv;
- рестартит только `adforge-mcp-staging-web` и `adforge-mcp-staging-http`;
- проверяет `/health`, `/ready`, static assets и `/mcp` без token = `401`.

## Перенос staging -> live

Рабочий процесс:

1. Разработчик делает правки локально.
2. Запускает локальные проверки.
3. Коммитит и пушит изменения в GitHub.
4. Деплоит ref на staging через `scripts/deploy_staging_dashboard.sh`.
5. Проверяет auth, dashboard, MCP, AI-анализ, экспорт отчета, mobile и logs на staging.
6. Если все ок, fast-forward merge в `main` или выбирает проверенный commit.
7. Делает live deploy штатным live runbook/script.
8. После live deploy проверяет live `/health`, `/ready`, `/mcp` без token, dashboard и logs.

Live deploy выполнять только после явного решения. Staging-проверка не является автоматическим разрешением на live.

## Rollback staging

Откатить staging на предыдущий commit:

```bash
cd /opt/adforge-mcp-staging
sudo bash scripts/deploy_staging_dashboard.sh <previous-good-commit>
```

Если нужно откатить данные staging:

```bash
sudo systemctl stop adforge-mcp-staging-web adforge-mcp-staging-http
sudo -u adforge cp /var/backups/adforge-mcp-staging/connections-YYYYMMDD-HHMMSS.json /var/lib/adforge-mcp-staging/connections.json
sudo chmod 600 /var/lib/adforge-mcp-staging/connections.json
sudo systemctl start adforge-mcp-staging-web adforge-mcp-staging-http
```

Live rollback описан отдельно в live runbook и не должен смешиваться со staging rollback.

## Что нельзя делать

- Не использовать live user database на staging.
- Не использовать live `connections.json` на staging.
- Не подключать реальные рекламные кабинеты без необходимости.
- Не копировать production credentials в staging без явного решения.
- Не коммитить `.env`, tokens, OAuth credentials, SMTP password, DB password, logs, backups, uploads или `connections.json`.
- Не отключать `AD_MCP_PREVIEW_ONLY=true`.
- Не открывать `/mcp` публично без bearer auth.
- Не деплоить сразу на live без проверки staging.

## Pre-commit проверки

Локально перед commit:

```bash
pytest -q
python -m compileall src scripts
node --check src/ad_mcp/web/static/app.js
git diff --check
```
