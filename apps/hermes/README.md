# Hermes HolyMedia MCP v2

Hermes v1 source is unavailable. This app is a clean V2 implementation and intentionally has no direct database or provider-credential access.

The gateway uses a scoped HolyMedia MCP service token and Telegram Bot API polling. It is read-only by default and rejects write requests before calling MCP. It supports `/hermes`, bot mentions, replies to the bot, update deduplication, chat allowlisting, and Telegram topic replies.

Required environment:

- `HERMES_ENABLED=true`
- `HERMES_TELEGRAM_BOT_TOKEN` (server-only)
- `HERMES_MCP_URL` (default `http://127.0.0.1:4000/mcp`)
- `HERMES_MCP_TOKEN` (scoped service token, server-only)
- `HERMES_ALLOWED_CHAT_IDS` (required when Hermes is enabled; comma-separated Telegram chat IDs)
- optional `HERMES_CHAT_ACCOUNT_BINDINGS` in the form
  `chat_id:account_id,chat_id:account_id`; the account must still be allowed by
  the scoped service token
- optional `HERMES_OPENAI_API_KEY` and `HERMES_OPENAI_MODEL`; OpenAI only
  rewrites the deterministic result and any failure silently keeps the local
  response

Hermes refuses to start when it is enabled without a chat allowlist. It never
logs these values and never reads provider credentials or the V2 database
directly. The configured scoped token should include only `adforge:mcp:read`
and the required workspace/account restrictions.
