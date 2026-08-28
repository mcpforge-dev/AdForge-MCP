import type { Job } from "bullmq";
import { loadConfig } from "@holymedia/config";
import type { DatabaseHandle } from "@holymedia/database";
import { createLogger } from "@holymedia/observability";

export const SUPPORT_TELEGRAM_QUEUE = "holymedia-v2-support-telegram";
export const SUPPORT_TELEGRAM_JOB = "support.telegram.notify";

export type SupportTelegramJobData = {
  supportRequestId: string;
  workspaceId: string;
};

const categoryLabels: Record<string, string> = {
  SUGGESTION: "Пожелание",
  PROBLEM: "Проблема",
  QUESTION: "Вопрос",
};

export async function processSupportTelegram(
  database: DatabaseHandle,
  job: Job<SupportTelegramJobData>,
) {
  const config = loadConfig();
  const logger = createLogger(
    "holymedia-mcp-v2-support-telegram",
    config.logLevel,
  );
  const row = await database.client.supportRequest.findFirst({
    where: {
      id: job.data.supportRequestId,
      workspaceId: job.data.workspaceId,
    },
    include: {
      user: { select: { name: true, email: true } },
      workspace: { select: { name: true } },
    },
  });
  if (!row) return { skipped: "missing" };
  if (row.telegramDeliveryStatus === "SENT") return { skipped: "sent" };
  if (!config.telegramSupportBotToken || !config.telegramSupportChatId) {
    await database.client.supportRequest.update({
      where: { id: row.id },
      data: { telegramDeliveryStatus: "NOT_CONFIGURED" },
    });
    return { skipped: "not_configured" };
  }

  await database.client.supportRequest.update({
    where: { id: row.id },
    data: {
      telegramDeliveryStatus: "SENDING",
      telegramDeliveryAttempts: { increment: 1 },
      telegramLastErrorCode: null,
    },
  });

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.telegramSupportBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegramSupportChatId,
          text: messageText(row),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Открыть заявку",
                  url: `${config.publicBaseUrl}/admin?section=support&request=${encodeURIComponent(row.id)}`,
                },
              ],
            ],
          },
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id?: number };
    } | null;
    if (!response.ok || !body?.ok)
      throw new TelegramDeliveryError(response.status);
    await database.client.supportRequest.update({
      where: { id: row.id },
      data: {
        telegramDeliveryStatus: "SENT",
        telegramMessageId: body.result?.message_id?.toString() ?? null,
        telegramDeliveredAt: new Date(),
        telegramLastErrorCode: null,
      },
    });
    await database.client.auditEvent.create({
      data: {
        actorType: "SERVICE",
        eventType: "support_telegram_delivered",
        workspaceId: row.workspaceId,
        targetType: "support_request",
        targetId: row.id,
      },
    });
    return { delivered: true };
  } catch (error) {
    const code = telegramErrorCode(error);
    await database.client.supportRequest.update({
      where: { id: row.id },
      data: { telegramDeliveryStatus: "FAILED", telegramLastErrorCode: code },
    });
    await database.client.auditEvent.create({
      data: {
        actorType: "SERVICE",
        eventType: "support_telegram_delivery_failed",
        success: false,
        workspaceId: row.workspaceId,
        targetType: "support_request",
        targetId: row.id,
        metadata: { code },
      },
    });
    logger.warn(
      {
        supportRequestId: row.id,
        errorCode: code,
        attempt: job.attemptsMade + 1,
      },
      "support Telegram delivery failed",
    );
    throw error;
  }
}

function messageText(row: {
  id: string;
  category: string;
  message: string;
  sourceRoute: string | null;
  locale: string | null;
  planKey: string | null;
  createdAt: Date;
  user: { name: string; email: string };
  workspace: { name: string };
}) {
  const email = escapeHtml(row.user.email);
  const lines = [
    "<b>💬 Новая заявка HolyMedia MCP</b>",
    "",
    `<b>Тема:</b> ${escapeHtml(categoryLabels[row.category] ?? "Обращение")}`,
    `<b>Пользователь:</b> ${escapeHtml(row.user.name)}`,
    `<b>Email:</b> <a href="mailto:${email}">${email}</a>`,
    `<b>Компания:</b> ${escapeHtml(row.workspace.name)}`,
    ...(row.planKey ? [`<b>Тариф:</b> ${escapeHtml(row.planKey)}`] : []),
    ...(row.sourceRoute
      ? [`<b>Страница:</b> ${escapeHtml(row.sourceRoute)}`]
      : []),
    "",
    "<b>Сообщение</b>",
    escapeHtml(truncate(row.message, 2_700)),
    "",
    `<b>Дата:</b> ${formatDate(row.createdAt)}`,
    `<b>Заявка:</b> #HM-${row.id.slice(0, 8).toUpperCase()}`,
  ];
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Almaty",
  }).format(value);
}

function telegramErrorCode(error: unknown): string {
  if (error instanceof TelegramDeliveryError) return `HTTP_${error.status}`;
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "TIMEOUT";
  return error instanceof Error
    ? error.constructor.name.toUpperCase().slice(0, 120)
    : "UNKNOWN";
}

class TelegramDeliveryError extends Error {
  public constructor(public readonly status: number) {
    super(`Telegram delivery failed with status ${status}`);
  }
}
