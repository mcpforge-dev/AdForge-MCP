# Live VPS commands HolyMedia MCP

Команды ниже рассчитаны на оператора live beta deploy. Значения `your-domain.com`, `<BETA_TOKEN>` и OAuth placeholders нужно заменить на реальные значения только на VPS. Не вставляйте реальные секреты в Git.

## 1. System packages

```bash
sudo apt update
sudo apt install -y git python3.11 python3.11-venv nginx certbot python3-certbot-nginx openssl
```

## 2. Service user and directories

```bash
sudo useradd --system --create-home --home-dir /opt/adforge-mcp --shell /usr/sbin/nologin HolyMedia
sudo mkdir -p /opt/adforge-mcp /etc/adforge-mcp /var/lib/adforge-mcp /var/log/adforge-mcp /var/backups/adforge-mcp
sudo chown -R adforge:adforge /opt/adforge-mcp /var/lib/adforge-mcp /var/log/adforge-mcp /var/backups/adforge-mcp
sudo chmod 755 /opt/adforge-mcp
sudo chmod 750 /etc/adforge-mcp /var/lib/adforge-mcp /var/log/adforge-mcp /var/backups/adforge-mcp
```

## 3. Clone and install

```bash
sudo -u adforge git clone git@github.com:mcpforge-dev/adforge-mcp.git /opt/adforge-mcp
cd /opt/adforge-mcp
sudo -u adforge python3.11 -m venv .venv
sudo -u adforge ./.venv/bin/python -m pip install --upgrade pip
sudo -u adforge ./.venv/bin/python -m pip install -e ".[google,meta]"
```

## 4. Env file

```bash
sudo cp /opt/adforge-mcp/deploy/adforge-mcp.env.example /etc/adforge-mcp/adforge-mcp.env
openssl rand -hex 32
sudo nano /etc/adforge-mcp/adforge-mcp.env
sudo chown root:adforge /etc/adforge-mcp/adforge-mcp.env
sudo chmod 640 /etc/adforge-mcp/adforge-mcp.env
```

В env file заменить:

```dotenv
AD_MCP_PUBLIC_BASE_URL=https://your-domain.com
AD_MCP_MCP_PUBLIC_URL=https://your-domain.com/mcp
AD_MCP_WEB_API_TOKEN=<BETA_TOKEN>
AD_MCP_CONNECTION_STORE_PATH=/var/lib/adforge-mcp/connections.json
AD_MCP_PREVIEW_ONLY=true
AD_MCP_CONNECTIONS_FALLBACK_TO_LOCAL=false
```

## 5. Storage

```bash
sudo -u adforge test -f /var/lib/adforge-mcp/connections.json || sudo -u adforge sh -c 'printf "%s\n" "{\"version\":1,\"connections\":{},\"oauth_pending\":{}}" > /var/lib/adforge-mcp/connections.json'
sudo chmod 600 /var/lib/adforge-mcp/connections.json
```

Backup:

```bash
sudo -u adforge cp /var/lib/adforge-mcp/connections.json "/var/backups/adforge-mcp/connections-$(date +%Y%m%d-%H%M%S).json"
sudo chmod 600 /var/backups/adforge-mcp/connections-*.json
```

Restore warning: this overwrites current connection storage.

```bash
sudo systemctl stop adforge-mcp-web adforge-mcp-http
sudo -u adforge cp /var/backups/adforge-mcp/connections-YYYYMMDD-HHMMSS.json /var/lib/adforge-mcp/connections.json
sudo chmod 600 /var/lib/adforge-mcp/connections.json
sudo systemctl start adforge-mcp-web adforge-mcp-http
```

## 6. Systemd

```bash
sudo cp /opt/adforge-mcp/deploy/adforge-mcp-web.service.example /etc/systemd/system/adforge-mcp-web.service
sudo cp /opt/adforge-mcp/deploy/adforge-mcp-http.service.example /etc/systemd/system/adforge-mcp-http.service
sudo systemctl daemon-reload
sudo systemctl enable --now adforge-mcp-web
sudo systemctl enable --now adforge-mcp-http
sudo systemctl status adforge-mcp-web
sudo systemctl status adforge-mcp-http
```

Logs:

```bash
sudo journalctl -u adforge-mcp-web -f
sudo journalctl -u adforge-mcp-http -f
```

## 7. Nginx and HTTPS

```bash
sudo cp /opt/adforge-mcp/deploy/nginx.adforge-mcp.example.conf /etc/nginx/sites-available/adforge-mcp
sudo nano /etc/nginx/sites-available/adforge-mcp
sudo ln -s /etc/nginx/sites-available/adforge-mcp /etc/nginx/sites-enabled/adforge-mcp
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
sudo nginx -t
sudo systemctl reload nginx
```

## 8. First checks

```bash
curl https://your-domain.com/health
curl https://your-domain.com/ready
curl -i https://your-domain.com/api/diagnostics
curl -i -H "Authorization: Bearer wrong-token" https://your-domain.com/api/diagnostics
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/diagnostics
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/diagnostics/security
curl -H "Authorization: Bearer <BETA_TOKEN>" https://your-domain.com/api/beta/capabilities
```

Strict hosted smoke:

```bash
cd /opt/adforge-mcp
sudo -u adforge ./.venv/bin/python scripts/smoke_hosted_beta.py \
  --base-url https://your-domain.com \
  --token "<BETA_TOKEN>" \
  --strict-deploy
```

Live read diagnostics are explicit:

```bash
sudo -u adforge ./.venv/bin/python scripts/smoke_hosted_beta.py \
  --base-url https://your-domain.com \
  --token "<BETA_TOKEN>" \
  --strict-deploy \
  --live
```

## 9. OAuth redirect URLs

Provider app settings:

```text
https://your-domain.com/oauth/meta/callback
https://your-domain.com/oauth/google/callback
https://your-domain.com/oauth/tiktok/callback
https://your-domain.com/oauth/yandex/callback
```

Restart after env changes:

```bash
sudo systemctl restart adforge-mcp-web adforge-mcp-http
```

## 10. Rollback

Destructive warning: `git checkout <previous-commit-or-tag>` changes the deployed code version.

```bash
sudo -u adforge cp /var/lib/adforge-mcp/connections.json "/var/backups/adforge-mcp/connections-before-rollback-$(date +%Y%m%d-%H%M%S).json"
sudo systemctl stop adforge-mcp-web adforge-mcp-http
cd /opt/adforge-mcp
sudo -u adforge git fetch origin main --tags
sudo -u adforge git checkout <previous-commit-or-tag>
sudo -u adforge ./.venv/bin/python -m pip install -e ".[google,meta]"
sudo systemctl start adforge-mcp-web adforge-mcp-http
curl https://your-domain.com/health
curl https://your-domain.com/ready
```
