# Hermes HolyMedia MCP v2

Hermes v1 source is unavailable. This app is a clean V2 implementation and intentionally has no direct database or provider-credential access.

The gateway uses a scoped HolyMedia MCP service token and Telegram Bot API polling. It is read-only by default and rejects write requests before calling MCP. It supports `/hermes`, bot mentions, replies to the bot, update deduplication, chat allowlisting, and Telegram topic replies.

Required environment:

- `HERMES_ENABLED=true`
- `HERMES_TELEGRAM_BOT_TOKEN` (server-only)
- `HERMES_MCP_URL` (default `http://127.0.0.1:4000/mcp`)
- `HERMES_MCP_TOKEN` (scoped service token, server-only)
- optional `HERMES_ALLOWED_CHAT_IDS`

Hermes never logs these values and never reads provider credentials or the V2 database directly.
