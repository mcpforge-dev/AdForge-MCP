const token = process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim();

if (!token) {
  console.error("Set TELEGRAM_SUPPORT_BOT_TOKEN in the operator shell.");
  process.exitCode = 1;
} else {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?timeout=0&limit=100`,
    { signal: AbortSignal.timeout(12_000) },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    console.error("Telegram updates request failed.");
    process.exitCode = 1;
  } else {
    const chats = new Map();
    for (const update of payload.result ?? []) {
      const chat = update.message?.chat ?? update.channel_post?.chat;
      if (!chat?.id) continue;
      chats.set(String(chat.id), {
        id: String(chat.id),
        type: chat.type ?? "unknown",
        title: chat.title ?? chat.username ?? "private chat",
      });
    }
    if (chats.size === 0) {
      console.log(
        "No updates found. Add the bot to the target group and send one non-sensitive message, then run this command again.",
      );
    } else {
      for (const chat of chats.values()) {
        console.log(
          `chat_id=${chat.id}\ttype=${chat.type}\tname=${chat.title}`,
        );
      }
    }
  }
}
