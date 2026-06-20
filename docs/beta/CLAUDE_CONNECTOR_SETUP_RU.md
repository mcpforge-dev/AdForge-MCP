# Подключение hosted AdForge MCP в Claude

Claude может подключать AdForge MCP как remote MCP server/custom connector, если выбранный клиент поддерживает hosted MCP URL и access token. Сервер уже должен быть развернут на VPS/VDS, а рекламные аккаунты должны быть подключены через AdForge dashboard.

## Что нужно заранее

- Hosted MCP URL, например `https://your-domain.com/mcp`.
- Персональный MCP token из dashboard: `/app` -> `MCP` -> `Создать MCP token`.
- Подключенные аккаунты в dashboard.

## Шаги в Claude

1. Открыть Claude settings.
2. Найти раздел `Connectors`.
3. Нажать `Customize`.
4. Нажать `+` или `Add custom connector`.
5. Указать Name: `AdForge MCP`.
6. Указать URL: `https://your-domain.com/mcp`.
7. Если Claude просит auth token/header, передать персональный MCP token:

```http
Authorization: Bearer <PERSONAL_MCP_TOKEN>
```

8. Сохранить connector.
9. Если Claude показывает permissions/tools, включить нужные разрешения.
10. Проверить, что connector доступен в чате.

Интерфейс Claude может меняться. Если конкретные поля отличаются, используйте фактические параметры: Name, URL и bearer/access token.

Если Claude.ai custom connector требует OAuth-настройку, не отключайте auth на `/mcp`. Для такого сценария нужен отдельный OAuth flow; текущий быстрый beta-сценарий рассчитан на клиентов, которые поддерживают remote MCP URL + Bearer/access token.

## Тестовые запросы

- `Проверь статус AdForge MCP`.
- `Какие рекламные аккаунты подключены?`
- `Покажи активные кампании`.
- `Покажи расходы и клики за вчера`.
- `Подготовь preview остановки кампании, но ничего не меняй`.

## Важное ограничение

Beta работает в preview-only mode. Claude не должен выполнять реальные изменения в рекламных кабинетах. Если пользователь просит изменить бюджет или остановить кампанию, AdForge MCP возвращает только preview с `will_apply=false`.
