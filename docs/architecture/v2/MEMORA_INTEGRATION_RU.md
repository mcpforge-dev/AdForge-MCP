# Memora в HolyMedia MCP

## Назначение

Memora подключён как локальный MCP-сервер для долговременной памяти проекта и рабочих заметок Codex. Источник закреплён на upstream-коммите:

`c32b40e0ac48029ddd252d3a3e958547f9a26b50`

Лицензия upstream: MIT. Пакет: `memora-mcp` версии `0.3.3`.

## Граница безопасности

Memora не является частью публичного API V2 и не получает доступ к PostgreSQL, OAuth credentials, service tokens, Telegram secrets или данным клиентских workspace. Его MCP transport работает только локально через stdio. Не запускать Memora с `streamable-http` или на публичном интерфейсе.

Локальная база находится в `.local/memora/memories.db`, каталог исключён из Git. Облачная синхронизация, S3/R2/D1 и графический HTTP-сервер не включены.

## Режим без платной модели

По умолчанию используются:

- `MEMORA_EMBEDDING_MODEL=tfidf`;
- `MEMORA_LLM_ENABLED=false`;
- ограниченный список тегов через `MEMORA_TAGS`.

OpenAI API key, embedding key и другие внешние AI API для установки не нужны и не добавляются в окружение.

## Установка

Из корня репозитория:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-memora.ps1
```

Конфигурация `.mcp.json` создаётся локально и игнорируется Git. Для другого компьютера скопируйте `.mcp.json.example` в `.mcp.json` после установки зависимостей.

После перезапуска Codex локальный сервер `memora` будет доступен вместе с памятью проекта.

## Обновление

Обновлять Memora только после просмотра upstream-релиза, проверки зависимостей и смены commit pin в `requirements-memora.txt`. После обновления запускать тесты upstream и локальную проверку запуска MCP.

## Что не сделано намеренно

Memora не встроен напрямую в Hermes и не используется для хранения клиентской памяти: у upstream-сервера нет нашего workspace/account authorization layer. Интеграция Hermes с tenant-scoped memory потребует отдельного адаптера V2 с серверной авторизацией и не должна делаться простой публикацией Memora HTTP endpoint.
