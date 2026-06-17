# Hosted MCP transport

Этот документ фиксирует первый рабочий вариант hosted MCP для beta.

## Что уже реализовано

- MCP работает через Streamable HTTP endpoint.
- Endpoint по умолчанию: `/mcp`.
- Внутренний порт по умолчанию: `127.0.0.1:8766`.
- Доступ закрыт bearer token: пользовательским MCP token из dashboard или fallback token из `AD_MCP_WEB_API_TOKEN` для smoke/operator сценариев.
- Stdio-режим `ad-mcp-server` сохранен для локальной разработки.

## Переменные окружения

```dotenv
AD_MCP_ENV=production
AD_MCP_WEB_API_TOKEN=change-this-beta-token
AD_MCP_PUBLIC_BASE_URL=https://mcp.adforge.example
AD_MCP_MCP_PUBLIC_URL=
AD_MCP_MCP_ENDPOINT_PATH=/mcp
AD_MCP_MCP_HTTP_HOST=127.0.0.1
AD_MCP_MCP_HTTP_PORT=8766
```

`AD_MCP_PUBLIC_BASE_URL` - внешний URL, который пользователь вставляет в Codex / Claude / другой MCP client.
Если MCP endpoint находится на отдельном домене или нестандартном пути, задайте полный `AD_MCP_MCP_PUBLIC_URL`, например `https://mcp.your-domain.com/mcp`.

## Запуск MCP transport

```bash
cd /opt/adforge-mcp
./.venv/bin/ad-mcp-http
```

Локально для проверки:

```bash
AD_MCP_ENV=production \
AD_MCP_WEB_API_TOKEN=smoke-token \
AD_MCP_PUBLIC_BASE_URL=http://127.0.0.1:8766 \
./.venv/bin/ad-mcp-http
```

## Nginx routing

Если web dashboard работает на `127.0.0.1:8765`, а MCP transport на `127.0.0.1:8766`, то reverse proxy должен развести пути:

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:8766;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Проверка

```bash
./.venv/bin/python scripts/smoke_mcp_beta.py
```

В ответе должен быть блок:

```json
"hosted_http": {
  "route": "/mcp",
  "route_registered": true,
  "auth_required": true,
  "unauthorized_status": 401
}
```

Для реального подключения MCP client должен отправлять персональный token пользователя:

```http
Authorization: Bearer <personal-mcp-token>
```

Персональный token создаётся в dashboard: `/app` -> `MCP` -> `Создать MCP token`.
Raw token показывается только один раз после создания или ротации. В базе хранится только hash и prefix.

`AD_MCP_WEB_API_TOKEN` не показывается клиентам. Он оставлен как fallback, чтобы не ломать strict smoke checks и текущую beta-инфраструктуру.

## Текущий beta-flow

Hosted MCP tools читают runtime-подключения из dashboard/OAuth connection store (`tokens/connections.json`). Локальный `ads_config.yaml` остается developer/server fallback и не является customer onboarding flow.

Для подключения клиента используйте:

- [CODEX_MCP_SETUP_RU.md](CODEX_MCP_SETUP_RU.md);
- [CLAUDE_CONNECTOR_SETUP_RU.md](CLAUDE_CONNECTOR_SETUP_RU.md);
- [OTHER_MCP_CLIENTS_RU.md](OTHER_MCP_CLIENTS_RU.md).
