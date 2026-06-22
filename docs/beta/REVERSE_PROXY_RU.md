# Reverse proxy и HTTPS

HolyMedia MCP beta публикуется через reverse proxy. Web dashboard и MCP transport должны слушать только localhost.

## Recommended internal routing

- Dashboard/API: `http://127.0.0.1:8765`.
- MCP transport: `http://127.0.0.1:8766/mcp`.
- Public URL: `https://your-domain.com`.

## Nginx example

В репозитории есть пример:

```text
deploy/nginx.adforge-mcp.example.conf
```

Пример включает:

- rate limiting для API, OAuth и MCP;
- `proxy_buffering off` для `/mcp`;
- явный forwarding `Authorization` header;
- отдельный routing `/api/`, `/oauth/` и `/mcp`;
- запрет доступа к private directories;
- CSP/security headers.

Минимальная схема:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 1m;

    location ^~ /mcp {
        proxy_pass http://127.0.0.1:8766;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
    }

    location ^~ /oauth/ {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
    }

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
    }

    location ~ /\.(env|git|ssh) { deny all; }
    location ~ /(tokens|secrets|logs|config|\.venv|deploy)/ { deny all; }
}
```

Для beta не включайте wildcard CORS. Dashboard и API должны работать same-origin через один публичный домен.

## HTTPS через Let's Encrypt

```bash
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
```

После certbot проверьте:

```bash
curl -I https://your-domain.com/health
curl -I https://your-domain.com/ready
```

## Forwarding headers

Обязательно передавать:

- `Host`;
- `Authorization`;
- `X-Forwarded-For`;
- `X-Forwarded-Host`;
- `X-Forwarded-Proto`;
- `X-Forwarded-Port`;
- `X-Real-IP`, если используется.

## MCP timeouts

Для `/mcp` рекомендуется:

- `proxy_buffering off`;
- `proxy_read_timeout 300s`;
- `proxy_send_timeout 300s`.

Это важно для Streamable HTTP transport.

Проверка, что `/mcp` ведет на настоящий MCP transport, а не web placeholder:

```bash
python scripts/smoke_hosted_beta.py --base-url https://your-domain.com --token "<BETA_TOKEN>" --strict-deploy
```

## Security headers

Web server уже выставляет базовые headers, но reverse proxy может продублировать:

```nginx
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy no-referrer always;
add_header Cross-Origin-Resource-Policy same-origin always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
```

## Rate limiting

Пример:

```nginx
limit_req_zone $binary_remote_addr zone=adforge_api:10m rate=60r/m;
limit_req_zone $binary_remote_addr zone=adforge_oauth:10m rate=20r/m;
limit_req_zone $binary_remote_addr zone=adforge_mcp:10m rate=120r/m;
```

Для production значения нужно подобрать по реальной нагрузке MCP-клиентов.

## Что нельзя публиковать

Нельзя отдавать наружу:

- `.env`;
- `.git`;
- `tokens/`;
- `secrets/`;
- `logs/`;
- `deploy/`;
- `.venv/`;
- raw config с секретами.

## Caddy alternative

```caddyfile
your-domain.com {
    reverse_proxy /mcp* 127.0.0.1:8766
    reverse_proxy 127.0.0.1:8765
}
```

Caddy сам выпускает HTTPS certificates, но для beta рекомендуемый путь в документации - Nginx + certbot.
