# Systemd service

Для текущей архитектуры выбран systemd, потому что HolyMedia MCP на VPS запускается как два Python-процесса за reverse proxy:

- `ad-mcp-web` для dashboard/API;
- `ad-mcp-http` для hosted MCP transport.

Docker можно добавить позже, но для текущего VPS beta systemd проще и прозрачнее.

## Files

Примеры лежат в:

- `deploy/adforge-mcp-web.service.example`;
- `deploy/adforge-mcp-http.service.example`.

Live env template: [../../deploy/adforge-mcp.env.example](../../deploy/adforge-mcp.env.example).

## Установка

```bash
sudo cp /opt/adforge-mcp/deploy/adforge-mcp-web.service.example /etc/systemd/system/adforge-mcp-web.service
sudo cp /opt/adforge-mcp/deploy/adforge-mcp-http.service.example /etc/systemd/system/adforge-mcp-http.service
sudo systemctl daemon-reload
```

## Запуск

```bash
sudo systemctl enable --now adforge-mcp-web
sudo systemctl enable --now adforge-mcp-http
```

## Проверка статуса

```bash
sudo systemctl status adforge-mcp-web
sudo systemctl status adforge-mcp-http
```

## Logs

```bash
sudo journalctl -u adforge-mcp-web -n 100 --no-pager
sudo journalctl -u adforge-mcp-http -n 100 --no-pager
sudo journalctl -u adforge-mcp-web -f
```

Логи не должны содержать raw tokens или client secrets.

## Restart после изменения env file

```bash
sudo systemctl restart adforge-mcp-web adforge-mcp-http
```

## Security options

Unit examples включают:

- отдельного пользователя `HolyMedia`;
- `NoNewPrivileges=true`;
- `PrivateTmp=true`;
- `ProtectSystem=full`;
- `ReadWritePaths=/var/lib/adforge-mcp /var/log/adforge-mcp`.

Сервисы не должны запускаться от `root`. Live env file доступен root/HolyMedia, а storage принадлежит service user:

```bash
sudo chown root:adforge /etc/adforge-mcp/adforge-mcp.env
sudo chmod 640 /etc/adforge-mcp/adforge-mcp.env
sudo chown -R adforge:adforge /var/lib/adforge-mcp /var/log/adforge-mcp
sudo chmod 750 /var/lib/adforge-mcp /var/log/adforge-mcp
sudo chmod 600 /var/lib/adforge-mcp/connections.json
```

Если путь установки отличается от `/opt/adforge-mcp`, обновите `WorkingDirectory`, `EnvironmentFile`, `ExecStart` и `ReadWritePaths`.
