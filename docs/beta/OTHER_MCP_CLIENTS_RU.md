# Gemini, ChatGPT и другие MCP clients

Этот документ описывает общий принцип подключения HolyMedia MCP в Gemini или другой MCP-compatible клиент. Конкретный UI клиента может отличаться.

## Главный принцип

HolyMedia MCP уже развернут как hosted service. Пользователь подключает внешний MCP endpoint, а рекламные аккаунты подключает отдельно через HolyMedia dashboard.

Не нужно:

- скачивать GitHub-репозиторий;
- запускать MCP server локально;
- передавать клиенту `.env`;
- вручную копировать provider access tokens.

## Что нужно клиенту

- Name: `HolyMedia MCP`.
- URL: `https://your-domain.com/mcp`.
- Auth header:

```http
Authorization: Bearer <PERSONAL_MCP_TOKEN>
```

## Универсальный пример

```json
{
  "name": "HolyMedia MCP",
  "url": "https://your-domain.com/mcp",
  "headers": {
    "Authorization": "Bearer <PERSONAL_MCP_TOKEN>"
  }
}
```

Если клиент поддерживает `mcpServers`, можно использовать [mcp.example.json](mcp.example.json).

## Порядок проверки

1. В dashboard подключить рекламные аккаунты через OAuth.
2. Убедиться, что Connections показывает `MCP ready`.
3. Добавить hosted MCP URL в клиент.
4. Передать персональный MCP token безопасным способом, который поддерживает клиент.
5. Проверить появление tools.
6. Запустить диагностику: `Проверь HolyMedia MCP`.
7. Запросить аккаунты: `Покажи подключенные рекламные аккаунты`.

## Ограничения

- Возможности конкретного MCP-клиента могут отличаться.
- Если клиент не поддерживает custom headers/Bearer token, нужен другой supported auth способ. Для ChatGPT Apps/connector сценария безопасный путь - OAuth 2.1, а не отключение auth.
- Рекламные аккаунты подключаются только через HolyMedia dashboard, не внутри Gemini/Codex/Claude.
- Dangerous actions остаются preview-only.
