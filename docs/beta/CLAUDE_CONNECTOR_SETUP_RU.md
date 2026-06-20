# Подключение hosted AdForge MCP в Claude

Claude может подключать AdForge MCP как remote MCP server/custom connector, если выбранный клиент поддерживает hosted MCP URL и access token. Сервер уже должен быть развернут на VPS/VDS, а рекламные аккаунты должны быть подключены через AdForge dashboard.

## Что нужно заранее

- Hosted MCP URL, например `https://your-domain.com/mcp`.
- Персональный MCP token из dashboard: `/app` -> `MCP` -> `Создать MCP token`.
- Подключенные аккаунты в dashboard.

## Шаги в Claude.ai custom connector

1. Открыть Claude settings.
2. Найти раздел `Connectors`.
3. Нажать `Customize`.
4. Нажать `+` или `Add custom connector`.
5. Указать Name: `AdForge MCP`.
6. Указать URL: `https://your-domain.com/mcp`.
7. Если видны поля `OAuth Client ID` и `OAuth Client Secret`, не вставлять туда персональный MCP token.
8. До внедрения OAuth authorization server эти поля можно оставить пустыми, но Claude.ai может не завершить подключение к защищенному `/mcp`.

Персональный MCP token подходит только для клиентов, которые явно поддерживают Bearer/access token:

```json
{
  "type": "url",
  "url": "https://your-domain.com/mcp",
  "name": "adforge-mcp",
  "authorization_token": "<PERSONAL_MCP_TOKEN>"
}
```

9. Сохранить connector.
10. Если Claude показывает permissions/tools, включить нужные разрешения.
11. Проверить, что connector доступен в чате.

Интерфейс Claude может меняться. Если конкретные поля отличаются, используйте фактические параметры: Name, URL и bearer/access token.

Если Claude.ai custom connector требует OAuth-настройку, не отключайте auth на `/mcp`. Для 100% self-serve Claude.ai сценария нужен отдельный OAuth flow: protected resource metadata, authorization endpoint, token endpoint, PKCE, scopes и привязка к user/workspace.

## Тестовые запросы

- `Проверь статус AdForge MCP`.
- `Какие рекламные аккаунты подключены?`
- `Покажи активные кампании`.
- `Покажи расходы и клики за вчера`.
- `Подготовь preview остановки кампании, но ничего не меняй`.

## Важное ограничение

Beta работает в preview-only mode. Claude не должен выполнять реальные изменения в рекламных кабинетах. Если пользователь просит изменить бюджет или остановить кампанию, AdForge MCP возвращает только preview с `will_apply=false`.
