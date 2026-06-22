# Подключение hosted HolyMedia MCP в Claude

Claude может подключать HolyMedia MCP как remote MCP server/custom connector, если выбранный клиент поддерживает hosted MCP URL и access token. Сервер уже должен быть развернут на VPS/VDS, а рекламные аккаунты должны быть подключены через HolyMedia dashboard.

## Что нужно заранее

- Hosted MCP URL, например `https://your-domain.com/mcp`.
- Персональный MCP token из dashboard: `/app` -> `MCP` -> `Создать MCP token`.
- Подключенные аккаунты в dashboard.

## Шаги в Claude.ai custom connector

1. Открыть Claude settings.
2. Найти раздел `Connectors`.
3. Нажать `Customize`.
4. Нажать `+` или `Add custom connector`.
5. Указать Name: `HolyMedia MCP`.
6. Указать URL: `https://your-domain.com/mcp`.
7. Если Claude зависает на `Checking connection`, откройте dashboard HolyMedia MCP -> вкладка `MCP` -> `Claude` и создайте `OAuth Client ID/Secret`.
8. Если credentials созданы, вставьте их в Advanced settings:
   - `OAuth Client ID`: значение из dashboard.
   - `OAuth Client Secret`: значение, показанное один раз после создания.
9. Если credentials не создавали, можно оставить поля пустыми и использовать Dynamic Client Registration.
10. Нажать `Add`.
11. На этапе `Connect` Claude откроет OAuth-вход в HolyMedia MCP.
12. Войти в HolyMedia MCP под нужным пользователем и разрешить подключение.

Персональный MCP token подходит только для клиентов, которые явно поддерживают Bearer/access token:

```json
{
  "type": "url",
  "url": "https://your-domain.com/mcp",
  "name": "adforge-mcp",
  "authorization_token": "<PERSONAL_MCP_TOKEN>"
}
```

13. Если Claude показывает permissions/tools, включить нужные разрешения.
14. Проверить, что connector доступен в чате.

Интерфейс Claude может меняться. Если конкретные поля отличаются, используйте фактические параметры: Name, URL и bearer/access token.

OAuth flow HolyMedia MCP включает protected resource metadata, authorization server metadata, Dynamic Client Registration, authorization endpoint, token endpoint, PKCE, scope `adforge:mcp` и привязку access token к user/workspace.

## Тестовые запросы

- `Проверь статус HolyMedia MCP`.
- `Какие рекламные аккаунты подключены?`
- `Покажи активные кампании`.
- `Покажи расходы и клики за вчера`.
- `Подготовь preview остановки кампании, но ничего не меняй`.

## Важное ограничение

Beta работает в preview-only mode. Claude не должен выполнять реальные изменения в рекламных кабинетах. Если пользователь просит изменить бюджет или остановить кампанию, HolyMedia MCP возвращает только preview с `will_apply=false`.
