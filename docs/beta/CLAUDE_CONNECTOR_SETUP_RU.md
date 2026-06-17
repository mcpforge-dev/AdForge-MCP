# Подключение hosted AdForge MCP в Claude

Claude подключает AdForge MCP как внешний custom connector. Сервер уже должен быть развернут на VPS/WPS, а рекламные аккаунты должны быть подключены через AdForge dashboard.

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
7. Если Claude просит auth headers, передать персональный MCP token:

```http
Authorization: Bearer <PERSONAL_MCP_TOKEN>
```

8. Сохранить connector.
9. Если Claude показывает permissions/tools, включить нужные разрешения.
10. Проверить, что connector доступен в чате.

Интерфейс Claude может меняться. Если конкретные поля отличаются, используйте фактические параметры: Name, URL и bearer token.

## Тестовые запросы

- `Проверь статус AdForge MCP`.
- `Какие рекламные аккаунты подключены?`
- `Покажи активные кампании`.
- `Покажи расходы и клики за вчера`.
- `Подготовь preview остановки кампании, но ничего не меняй`.

## Важное ограничение

Beta работает в preview-only mode. Claude не должен выполнять реальные изменения в рекламных кабинетах. Если пользователь просит изменить бюджет или остановить кампанию, AdForge MCP возвращает только preview с `will_apply=false`.
