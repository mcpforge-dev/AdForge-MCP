# Telegram support notifications

The support form stores every request in PostgreSQL first. Telegram is an
asynchronous notification channel and must never be used as the source of
truth.

## Production configuration

Set the following values only in the protected production environment:

- `TELEGRAM_SUPPORT_BOT_TOKEN`
- `TELEGRAM_SUPPORT_CHAT_ID`

Never add either value to Git, screenshots, CI output, or application logs.

## One-time chat ID discovery

1. Add the bot to the intended private support group.
2. Send one non-sensitive message in that group so Telegram creates an update.
3. Run the local operator command with the token supplied through the process
   environment:

   ```powershell
   $env:TELEGRAM_SUPPORT_BOT_TOKEN = (Get-Content -Raw -LiteralPath 'C:\secure\bot-token.txt').Trim()
   node scripts/telegram-support-chat-id.mjs
   Remove-Item Env:TELEGRAM_SUPPORT_BOT_TOKEN
   ```

The script prints candidate chat IDs and group names only; it never prints the
bot token. Save the selected ID only in the protected production environment.
