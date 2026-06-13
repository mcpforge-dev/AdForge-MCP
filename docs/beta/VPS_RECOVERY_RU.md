# VPS recovery checklist для hosted beta

Этот документ нужен на случай, когда live VPS/WPS временно недоступен: сайт не грузится, `22/443` не отвечают, SSH не подключается.

Важно: не делать бесконечные SSH-попытки и не пытаться brute-force доступ. Если SSH и HTTPS недоступны, сначала восстановить доступ через панель провайдера, VNC/serial console или rescue mode.

## 1. Проверить сервер в панели провайдера

В панели VPS/WPS проверить:

- сервер включен и не suspended;
- нет неоплаченного счета или provider-level блокировки;
- IPv4/IPv6 назначены серверу;
- firewall/security group у провайдера пропускает `22`, `80`, `443`;
- нет активного rescue/reinstall режима;
- есть свежий snapshot/backup перед ручными правками.

Если сервер завис, сначала сделать soft reboot из панели. Если после reboot `22/443` не поднялись, открыть VNC/console.

## 2. Проверить базовое состояние через VNC/console

После входа через provider console:

```bash
uptime
df -h
free -h
ip addr
ip route
sudo systemctl --failed --no-pager
```

Если диск заполнен, сначала освободить место в логах/кеше. Не удалять `/opt/adforge-mcp/tokens/connections.json` и backup-директории без отдельного решения.

## 3. Проверить firewall и порты

```bash
sudo ufw status verbose || true
sudo iptables -S || true
sudo ss -ltnp | grep -E ':22|:80|:443|:8765|:8766' || true
```

Ожидаемо:

- `sshd` слушает `22`;
- Nginx слушает `80/443`;
- `adforge-mcp-web` слушает локальный backend port;
- `adforge-mcp-http` слушает локальный MCP transport port.

## 4. Проверить systemd services

```bash
sudo systemctl status ssh --no-pager
sudo systemctl status nginx --no-pager
sudo systemctl status adforge-mcp-web --no-pager
sudo systemctl status adforge-mcp-http --no-pager
```

Если Nginx упал:

```bash
sudo nginx -t
sudo journalctl -u nginx -n 100 --no-pager
```

Если AdForge service упал:

```bash
sudo journalctl -u adforge-mcp-web -n 100 --no-pager
sudo journalctl -u adforge-mcp-http -n 100 --no-pager
```

Не вставлять в чат полные логи, если там могут быть token/secret values. Перед отправкой редактировать `Authorization`, `access_token`, `refresh_token`, `client_secret`, `app_secret`, `developer_token`.

## 5. Проверить SSH block/fail2ban

```bash
sudo fail2ban-client status || true
sudo journalctl -u ssh -n 100 --no-pager
```

Если IP был заблокирован fail2ban, снять бан только для нужного IP и записать причину в deployment notes.

## 6. Проверить приложение после восстановления

После того как `22/443` снова доступны:

```bash
curl -fsS https://77.240.38.131.sslip.io/health
curl -fsS https://77.240.38.131.sslip.io/ready
curl -fsS https://77.240.38.131.sslip.io/assets/app.js >/dev/null
curl -fsS https://77.240.38.131.sslip.io/assets/app.css >/dev/null
```

Проверка с beta token:

```bash
python scripts/smoke_hosted_beta.py \
  --base-url https://77.240.38.131.sslip.io \
  --token "<BETA_TOKEN>" \
  --strict-deploy
```

Не печатать реальный beta token в терминал, скриншоты или чат.

## 7. Обновить dashboard после восстановления

Когда сервер восстановлен и рабочее дерево чистое, оператор может выполнить:

```bash
cd /opt/adforge-mcp
bash scripts/deploy_live_dashboard.sh
```

Скрипт делает fast-forward pull, перезапускает только `adforge-mcp-web` и проверяет `/health`, `/ready`, `app.js`, `app.css`. Он не меняет OAuth credentials и не трогает `tokens/connections.json`.
