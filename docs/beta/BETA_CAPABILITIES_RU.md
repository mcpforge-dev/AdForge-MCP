# Beta capabilities endpoint

`GET /api/beta/capabilities` возвращает безопасную сводку возможностей hosted beta.

Endpoint закрыт beta token:

```http
GET /api/beta/capabilities
Authorization: Bearer <BETA_TOKEN>
```

## Для чего нужен endpoint

- быстро показать beta-scope dashboard или оператору;
- проверить, что сервер работает в hosted beta mode;
- получить hosted MCP URL;
- увидеть список MCP tools;
- увидеть preview-only posture;
- проверить, что клиентская модель не требует локального запуска.

## Что возвращается

Основные поля:

- `mode=hosted_beta`;
- `service=HolyMedia MCP`;
- `scope.client_model=hosted_dashboard_oauth_plus_hosted_mcp`;
- `scope.customer_local_setup_required=false`;
- `scope.primary_platforms=["meta_ads","google_ads"]`;
- `scope.limited_platforms` для TikTok/Yandex;
- `platforms` со статусами и account count;
- `mcp.url`;
- `mcp.tools`;
- `preview_only.enabled`;
- `preview_only.live_writes_enabled=false`;
- `security.mcp_public_url_configured`;
- `security.tokens_returned=false`;
- links на diagnostics endpoints.

## Что специально не возвращается

Endpoint не должен возвращать:

- `access_token`;
- `refresh_token`;
- `client_secret`;
- `app_secret`;
- `developer_token`;
- beta token;
- OAuth authorization code;
- raw provider credentials.

## Пример проверки

```bash
curl -H "Authorization: Bearer <BETA_TOKEN>" \
  https://your-domain.com/api/beta/capabilities
```

Запрос без token должен быть отклонен:

```bash
curl -i https://your-domain.com/api/beta/capabilities
```

Ожидаемый результат: `401` или `403`.

## Связанные проверки

- [END_TO_END_BETA_VALIDATION_RU.md](END_TO_END_BETA_VALIDATION_RU.md)
- [BETA_ACCEPTANCE_CHECKLIST_RU.md](BETA_ACCEPTANCE_CHECKLIST_RU.md)
- [SECURITY_HARDENING_RU.md](SECURITY_HARDENING_RU.md)
