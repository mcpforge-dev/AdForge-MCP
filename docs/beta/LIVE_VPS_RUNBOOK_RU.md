# Live VPS runbook для hosted beta HolyMedia MCP

Этот runbook описывает первый live deploy HolyMedia MCP на реальном VPS/WPS. Это инструкция для оператора или разработчика проекта. Beta-клиент не клонирует GitHub repo, не запускает MCP локально и не редактирует `.env`: клиент получает dashboard URL, hosted MCP URL и beta token.

## A. Предварительные требования

- SSH-доступ к VPS/WPS.
- Ubuntu 22.04 LTS или совместимая Linux-система.
- Домен или поддомен для beta.
- DNS A-record домена на IPv4 сервера.
- Python 3.11+.
- Git.
- Nginx.
- Certbot.
- systemd.
- Доступ к GitHub repo `mcpforge-dev/adforge-mcp`.
- Реальные OAuth app credentials для нужных providers.
- Сильный beta token для `AD_MCP_WEB_API_TOKEN`.
- Решение, где хранится hosted connection storage: рекомендуем `/var/lib/adforge-mcp/connections.json`.

## B. Подготовка сервера

Установить системные зависимости:

```bash
sudo apt update
sudo apt install -y git python3.11 python3.11-venv nginx certbot python3-certbot-nginx openssl
```

Создать service user и директории:

```bash
sudo useradd --system --create-home --home-dir /opt/adforge-mcp --shell /usr/sbin/nologin HolyMedia
sudo mkdir -p /opt/adforge-mcp /etc/adforge-mcp /var/lib/adforge-mcp /var/log/adforge-mcp
sudo chown -R adforge:adforge /opt/adforge-mcp /var/lib/adforge-mcp /var/log/adforge-mcp
sudo chmod 755 /opt/adforge-mcp
sudo chmod 750 /etc/adforge-mcp /var/lib/adforge-mcp /var/log/adforge-mcp
```

Клонировать репозиторий на VPS. Это делает оператор, не beta-клиент:

```bash
sudo -u adforge git clone git@github.com:mcpforge-dev/adforge-mcp.git /opt/adforge-mcp
```

Создать virtualenv и установить зависимости:

```bash
cd /opt/adforge-mcp
sudo -u adforge python3.11 -m venv .venv
sudo -u adforge ./.venv/bin/python -m pip install --upgrade pip
sudo -u adforge ./.venv/bin/python -m pip install -e ".[google,meta]"
```

## C. Настройка env file

Live env хранится вне repo:

```bash
sudo cp /opt/adforge-mcp/deploy/adforge-mcp.env.example /etc/adforge-mcp/adforge-mcp.env
sudo nano /etc/adforge-mcp/adforge-mcp.env
sudo chown root:adforge /etc/adforge-mcp/adforge-mcp.env
sudo chmod 640 /etc/adforge-mcp/adforge-mcp.env
```

Обязательные переменные:

- `AD_MCP_ENV=beta`;
- `AD_MCP_WEB_HOST=127.0.0.1`;
- `AD_MCP_WEB_PORT=8765`;
- `AD_MCP_MCP_HTTP_HOST=127.0.0.1`;
- `AD_MCP_MCP_HTTP_PORT=8766`;
- `AD_MCP_PUBLIC_BASE_URL=https://your-domain.com`;
- `AD_MCP_MCP_PUBLIC_URL=https://your-domain.com/mcp`;
- `AD_MCP_WEB_API_TOKEN=<strong-beta-token>`;
- `AD_MCP_PREVIEW_ONLY=true`;
- `AD_MCP_CONNECTION_STORE_PATH=/var/lib/adforge-mcp/connections.json`;
- `AD_MCP_CONNECTIONS_FALLBACK_TO_LOCAL=false`.

Сгенерировать beta token:

```bash
openssl rand -hex 32
```

`AD_MCP_PREVIEW_ONLY=true` обязателен для beta: реальные write/apply действия в рекламных кабинетах должны быть заблокированы.

OAuth credentials:

- Meta: `AD_MCP_META_OAUTH_APP_ID`, `AD_MCP_META_OAUTH_APP_SECRET`;
- Google: `AD_MCP_GOOGLE_OAUTH_CLIENT_ID`, `AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET`, `AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN`;
- TikTok: `AD_MCP_TIKTOK_OAUTH_APP_ID`, `AD_MCP_TIKTOK_OAUTH_APP_SECRET`;
- Yandex: `AD_MCP_YANDEX_OAUTH_CLIENT_ID`, `AD_MCP_YANDEX_OAUTH_CLIENT_SECRET`.

Optional переменные описаны в [ENVIRONMENT_RU.md](ENVIRONMENT_RU.md).

## D. Storage

Создать storage:

```bash
sudo mkdir -p /var/lib/adforge-mcp /var/backups/adforge-mcp
sudo chown -R adforge:adforge /var/lib/adforge-mcp /var/backups/adforge-mcp
sudo chmod 750 /var/lib/adforge-mcp /var/backups/adforge-mcp
sudo -u adforge test -f /var/lib/adforge-mcp/connections.json || sudo -u adforge sh -c 'printf "%s\n" "{\"version\":1,\"connections\":{},\"oauth_pending\":{}}" > /var/lib/adforge-mcp/connections.json'
sudo chmod 600 /var/lib/adforge-mcp/connections.json
```

Проверить, что storage не публичный:

```bash
curl -i https://your-domain.com/tokens/connections.json
curl -i https://your-domain.com/var/lib/adforge-mcp/connections.json
```

Ожидаемо: `403` или `404`.

Backup:

```bash
sudo -u adforge cp /var/lib/adforge-mcp/connections.json "/var/backups/adforge-mcp/connections-$(date +%Y%m%d-%H%M%S).json"
sudo chmod 600 /var/backups/adforge-mcp/connections-*.json
```

Restore:

```bash
sudo systemctl stop adforge-mcp-web adforge-mcp-http
sudo -u adforge cp /var/backups/adforge-mcp/connections-YYYYMMDD-HHMMSS.json /var/lib/adforge-mcp/connections.json
sudo chmod 600 /var/lib/adforge-mcp/connections.json
sudo systemctl start adforge-mcp-web adforge-mcp-http
```

## E. Systemd

Скопировать service files:

```bash
sudo cp /opt/adforge-mcp/deploy/adforge-mcp-web.service.example /etc/systemd/system/adforge-mcp-web.service
sudo cp /opt/adforge-mcp/deploy/adforge-mcp-http.service.example /etc/systemd/system/adforge-mcp-http.service
sudo systemctl daemon-reload
```

Проверить, что в service files:

- `User=HolyMedia`;
- `Group=HolyMedia`;
- `WorkingDirectory=/opt/adforge-mcp`;
- `EnvironmentFile=/etc/adforge-mcp/adforge-mcp.env`;
- web bind: `AD_MCP_WEB_HOST=127.0.0.1`, port `8765`;
- MCP bind: `AD_MCP_MCP_HTTP_HOST=127.0.0.1`, port `8766`;
- `Restart=on-failure`;
- сервисы не запускаются от root.

Запуск:

```bash
sudo systemctl enable --now adforge-mcp-web
sudo systemctl enable --now adforge-mcp-http
```

Status и logs:

```bash
sudo systemctl status adforge-mcp-web
sudo systemctl status adforge-mcp-http
sudo journalctl -u adforge-mcp-web -f
sudo journalctl -u adforge-mcp-http -f
```

## F. Nginx + HTTPS

Скопировать конфиг:

```bash
sudo cp /opt/adforge-mcp/deploy/nginx.adforge-mcp.example.conf /etc/nginx/sites-available/adforge-mcp
sudo nano /etc/nginx/sites-available/adforge-mcp
```

Заменить `your-domain.com` на реальный домен.

Проверить routing:

- `/` -> web dashboard `127.0.0.1:8765`;
- `/api/` -> web backend `127.0.0.1:8765`;
- `/oauth/` -> web backend `127.0.0.1:8765`;
- `/mcp` -> настоящий MCP HTTP service `127.0.0.1:8766`;
- `Authorization` header прокидывается через `proxy_set_header Authorization $http_authorization`;
- `X-Forwarded-*` headers проставлены;
- private files не отдаются.

Включить site и HTTPS:

```bash
sudo ln -s /etc/nginx/sites-available/adforge-mcp /etc/nginx/sites-enabled/adforge-mcp
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
sudo nginx -t
sudo systemctl reload nginx
```

Проверить, что `/mcp` не ведет на web placeholder:

```bash
python scripts/smoke_hosted_beta.py --base-url https://your-domain.com --token "<BETA_TOKEN>" --strict-deploy
```

Если smoke получает `501` или сообщение `mcp_transport_not_served_by_web_process`, Nginx направляет `/mcp` не туда.

## G. OAuth redirect URLs

В provider apps прописать:

- Meta: `https://your-domain.com/oauth/meta/callback`;
- Google: `https://your-domain.com/oauth/google/callback`;
- TikTok: `https://your-domain.com/oauth/tiktok/callback`;
- Yandex: `https://your-domain.com/oauth/yandex/callback`.

Checklist provider settings:

- redirect URL совпадает с доменом и path один-в-один;
- app/client id и secret внесены в `/etc/adforge-mcp/adforge-mcp.env`;
- scopes соответствуют beta docs;
- provider app имеет нужный статус review/approved;
- у тестового пользователя есть доступ к рекламным аккаунтам;
- после изменения env выполнен restart systemd services.

## H. First deploy verification

```bash
curl https://your-domain.com/health
curl https://your-domain.com/ready
curl -i https://your-domain.com/api/diagnostics
curl -i -H "Authorization: Bearer wrong-token" https://your-domain.com/api/diagnostics
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/diagnostics
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/diagnostics/security
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/beta/capabilities
```

Запустить hosted smoke:

```bash
cd /opt/adforge-mcp
sudo -u adforge ./.venv/bin/python scripts/smoke_hosted_beta.py \
  --base-url https://your-domain.com \
  --token "<BETA_TOKEN>" \
  --strict-deploy
```

## I. Dashboard verification

1. Открыть `https://your-domain.com`.
2. Ввести beta token.
3. Перейти в `Connections`.
4. Увидеть Meta, Google, TikTok, Yandex cards.
5. Проверить `Copy MCP URL`.
6. Нажать `Run diagnostics`.
7. Убедиться, что dashboard не показывает raw tokens.

## J. MCP verification

1. Проверить, что `/mcp` без token отклоняется.
2. Подключить hosted MCP URL в Codex или Claude.
3. Указать bearer token.
4. Выполнить `run_diagnostics`.
5. Выполнить `list_connected_platforms`.
6. Выполнить `list_ad_accounts`.

## K. OAuth live verification

Meta:

- пройти OAuth;
- выбрать ad accounts;
- проверить `list_ad_accounts`;
- проверить campaigns/metrics, если аккаунт имеет доступ.

Google:

- пройти OAuth;
- выбрать customer accounts;
- проверить developer token и customer hierarchy;
- проверить campaigns/metrics, если credentials валидны.

TikTok:

- проверять live только при реальных approved credentials;
- если campaigns/metrics limited, возвращать `not_available`, не fake data.

Yandex:

- проверять live только при реальных OAuth/API access;
- если campaigns/metrics limited, возвращать `not_available`, не fake data.

## L. Preview-only verification

Через MCP-клиент вызвать:

- `preview_change_campaign_budget`;
- `preview_pause_campaign`;
- `commit_preview`.

Ожидаемо:

- `will_apply=false`;
- `mode=preview_only`;
- `commit_preview` blocked;
- logs не содержат provider write endpoint calls.

## M. Rollback

Перед rollback сделать backup storage:

```bash
sudo -u adforge cp /var/lib/adforge-mcp/connections.json "/var/backups/adforge-mcp/connections-before-rollback-$(date +%Y%m%d-%H%M%S).json"
```

Остановить сервисы:

```bash
sudo systemctl stop adforge-mcp-web adforge-mcp-http
```

Откатить код к предыдущему commit/tag:

```bash
cd /opt/adforge-mcp
sudo -u adforge git fetch origin main --tags
sudo -u adforge git checkout <previous-commit-or-tag>
sudo -u adforge ./.venv/bin/python -m pip install -e ".[google,meta]"
```

Восстановить storage, если нужно:

```bash
sudo -u adforge cp /var/backups/adforge-mcp/connections-YYYYMMDD-HHMMSS.json /var/lib/adforge-mcp/connections.json
sudo chmod 600 /var/lib/adforge-mcp/connections.json
```

Запустить и проверить:

```bash
sudo systemctl start adforge-mcp-web adforge-mcp-http
curl https://your-domain.com/health
curl https://your-domain.com/ready
```

Rollback успешен, если services active, `/ready` OK, diagnostics с token работает, `/mcp` подключается через bearer token.

## N. Post-deploy checklist

- [ ] DNS A-record указывает на VPS IP.
- [ ] HTTPS certificate active.
- [ ] `adforge-mcp-web` active.
- [ ] `adforge-mcp-http` active.
- [ ] `/health` OK.
- [ ] `/ready` OK.
- [ ] `/api/diagnostics` без token rejected.
- [ ] `/api/diagnostics` с token OK.
- [ ] `/api/diagnostics/security` OK.
- [ ] `/api/beta/capabilities` OK.
- [ ] `smoke_hosted_beta.py --strict-deploy` OK.
- [ ] Dashboard OK.
- [ ] Hosted MCP OK.
- [ ] Meta OAuth проверен или честно blocked by credentials.
- [ ] Google OAuth проверен или честно blocked by credentials.
- [ ] Preview-only проверен.
- [ ] Logs без секретов.
- [ ] Storage backup сделан.
