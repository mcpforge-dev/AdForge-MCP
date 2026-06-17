# Подключение hosted AdForge MCP в Codex

Эта инструкция описывает beta-сценарий. Сервер уже развернут на VPS/WPS. Пользователь не скачивает GitHub-репозиторий и не запускает MCP локально.

## Что нужно заранее

- Dashboard URL.
- Hosted MCP URL, например `https://your-domain.com/mcp`.
- Персональный MCP token из dashboard: `/app` -> `MCP` -> `Создать MCP token`.
- Подключенные рекламные аккаунты в dashboard.

## Шаги в Codex

1. Открыть настройки Codex.
2. Найти раздел MCP.
3. Нажать `Add server` или аналогичную кнопку добавления MCP server.
4. Указать имя: `AdForge MCP`.
5. Выбрать HTTP/Streamable HTTP transport, если интерфейс клиента дает выбор.
6. Указать URL hosted endpoint: `https://your-domain.com/mcp`.
7. Передать персональный MCP token одним из двух способов.

### Вариант A: поле Bearer token environment variable

Если Codex показывает поле `Bearer token environment variable`, туда нужно вставить не сам token, а имя переменной окружения:

```text
ADFORGE_MCP_CLIENT_TOKEN
```

Сам raw token нужно сохранить в этой переменной окружения на компьютере, где запущен Codex, затем полностью перезапустить Codex.

PowerShell пример:

```powershell
setx ADFORGE_MCP_CLIENT_TOKEN "<PERSONAL_MCP_TOKEN>"
```

После `setx` новое значение увидят только новые процессы, поэтому Codex нужно закрыть и открыть заново.

### Вариант B: прямой HTTP header

Если Codex или другой MCP-клиент просит прямой заголовок, используйте:

```http
Authorization: Bearer <PERSONAL_MCP_TOKEN>
```

8. Сохранить сервер.
9. Проверить, что tools AdForge MCP появились в списке.

Важно: если token попал в скриншот, чат или лог, его нужно сразу заменить через dashboard: `/app` -> `MCP` -> `Сгенерировать новый token`.

UI Codex может меняться. Важны не названия кнопок, а параметры подключения: server name, hosted MCP endpoint и bearer token.

## Пример config

Смотрите [mcp.example.json](mcp.example.json). В нем нет реальных секретов.

```json
{
  "mcpServers": {
    "adforge-mcp": {
      "transport": "streamable_http",
      "url": "https://your-domain.com/mcp",
      "headers": {
        "Authorization": "Bearer <PERSONAL_MCP_TOKEN>"
      }
    }
  }
}
```

## Тестовые запросы

- `Проверь диагностику AdForge MCP`.
- `Покажи подключенные рекламные платформы`.
- `Покажи список рекламных аккаунтов`.
- `Покажи кампании Meta Ads`.
- `Покажи базовые метрики за последние 7 дней`.
- `Сделай preview изменения бюджета кампании, но не применяй его`.

## Если Codex не видит tools

Проверьте:

- MCP URL скопирован из dashboard без лишних пробелов;
- если использовано поле `Bearer token environment variable`, в нем стоит имя переменной `ADFORGE_MCP_CLIENT_TOKEN`, а не raw token;
- Codex был перезапущен после `setx` или изменения переменных окружения;
- personal MCP token передан через `Authorization: Bearer ...` или через корректную env-переменную;
- dashboard показывает `MCP ready`;
- endpoint `/api/diagnostics/mcp` доступен через dashboard API;
- hosted MCP process запущен на сервере.
