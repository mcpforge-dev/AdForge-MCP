import type { Job } from "bullmq";
import { loadConfig } from "@holymedia/config";
import { tariffPresentation } from "@holymedia/contracts";
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
  // A stored message ID is delivery evidence, including historical rows whose
  // status was incorrectly downgraded by an ancillary failure.
  if (row.telegramMessageId)
    return { delivered: true, telegramMessageId: row.telegramMessageId };
  if (["SENT", "SENDING", "UNCERTAIN"].includes(row.telegramDeliveryStatus))
    return { delivered: false, status: "uncertain" };
  if (!config.telegramSupportBotToken || !config.telegramSupportChatId) {
    await database.client.supportRequest.updateMany({
      where: {
        id: row.id,
        telegramMessageId: null,
        telegramDeliveryStatus: { in: ["PENDING", "FAILED", "NOT_CONFIGURED"] },
      },
      data: { telegramDeliveryStatus: "NOT_CONFIGURED" },
    });
    return { skipped: "not_configured" };
  }

  // Per-request atomic claim. Never reclaim SENDING automatically: a crashed
  // process may have sent the HTTP request before it could persist the outcome.
  const claim = await database.client.supportRequest.updateMany({
    where: {
      id: row.id,
      workspaceId: row.workspaceId,
      telegramMessageId: null,
      telegramDeliveryStatus: { in: ["PENDING", "FAILED", "NOT_CONFIGURED"] },
    },
    data: {
      telegramDeliveryStatus: "SENDING",
      telegramDeliveryAttempts: { increment: 1 },
      telegramLastErrorCode: null,
    },
  });
  if (claim.count !== 1) {
    const current = await database.client.supportRequest.findFirst({
      where: { id: row.id, workspaceId: row.workspaceId },
    });
    return current?.telegramMessageId
      ? { delivered: true, telegramMessageId: current.telegramMessageId }
      : { delivered: false, status: "uncertain" };
  }

  let confirmedMessageId: string | undefined;
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
    // Only a parsed explicit refusal is known not to have delivered. Invalid
    // JSON, HTTP proxy errors and timeouts have an unknown external outcome.
    if (body?.ok === false) throw new TelegramDeliveryError(response.status);
    const messageId = body?.result?.message_id;
    if (!body?.ok || !isTelegramMessageId(messageId))
      throw new Error("Unconfirmed Telegram response");
    confirmedMessageId = messageId.toString();
    await database.client.supportRequest.updateMany({
      where: {
        id: row.id,
        telegramDeliveryStatus: "SENDING",
        telegramMessageId: null,
      },
      data: {
        telegramDeliveryStatus: "SENT",
        telegramMessageId: messageId.toString(),
        telegramDeliveredAt: new Date(),
        telegramLastErrorCode: null,
      },
    });
    await database.client.auditEvent
      .create({
        data: {
          actorType: "SERVICE",
          eventType: "support_telegram_delivered",
          workspaceId: row.workspaceId,
          targetType: "support_request",
          targetId: row.id,
        },
      })
      .catch(() =>
        logger.error(
          { supportRequestId: row.id },
          "support delivery audit insert failed",
        ),
      );
    return { delivered: true, telegramMessageId: messageId.toString() };
  } catch (error) {
    if (confirmedMessageId) {
      // Do not retry the external send when persistence is temporarily down.
      // BullMQ retains this confirmation; SENDING also prevents re-delivery.
      logger.error(
        { supportRequestId: row.id },
        "support confirmed delivery persistence failed",
      );
      return { delivered: true, telegramMessageId: confirmedMessageId };
    }
    const code = telegramErrorCode(error);
    const knownFailure = error instanceof TelegramDeliveryError;
    await database.client.supportRequest
      .updateMany({
        where: {
          id: row.id,
          telegramDeliveryStatus: "SENDING",
          telegramMessageId: null,
        },
        data: {
          telegramDeliveryStatus: knownFailure ? "FAILED" : "UNCERTAIN",
          telegramLastErrorCode: code,
        },
      })
      .catch(() =>
        logger.error(
          { supportRequestId: row.id },
          "support delivery outcome persistence failed",
        ),
      );
    await database.client.auditEvent
      .create({
        data: {
          actorType: "SERVICE",
          eventType: "support_telegram_delivery_failed",
          success: false,
          workspaceId: row.workspaceId,
          targetType: "support_request",
          targetId: row.id,
          metadata: { code },
        },
      })
      .catch(() =>
        logger.error(
          { supportRequestId: row.id },
          "support delivery failure audit insert failed",
        ),
      );
    logger.warn(
      {
        supportRequestId: row.id,
        errorCode: code,
        attempt: job.attemptsMade + 1,
      },
      "support Telegram delivery failed",
    );
    if (knownFailure) throw error;
    return { delivered: false, status: "uncertain" };
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
  const tariff = tariffPresentation(row.planKey);
  const lines = [
    "<b>💬 Новая заявка HolyMedia MCP</b>",
    "",
    `<b>Тема:</b> ${escapeHtml(categoryLabels[row.category] ?? "Обращение")}`,
    `<b>Пользователь:</b> ${escapeHtml(row.user.name)}`,
    `<b>Email:</b> <a href="mailto:${email}">${email}</a>`,
    `<b>Компания:</b> ${escapeHtml(row.workspace.name)}`,
    [
      `<b>Тариф / Plan:</b> ${escapeHtml(`${tariff.full.ru} / ${tariff.full.en}`)}`,
    ],
    ...(row.sourceRoute
      ? [
          `<b>Страница / Page:</b> <a href="${escapeHtml(row.sourceRoute)}">${escapeHtml(row.sourceRoute)}</a>`,
        ]
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

function isTelegramMessageId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Almaty",
  }).format(value);
}

function telegramErrorCode(error: unknown): string {
  if (error instanceof TelegramDeliveryError) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "TIMEOUT";
  return error instanceof Error
    ? error.constructor.name.toUpperCase().slice(0, 120)
    : "UNKNOWN";
}

class TelegramDeliveryError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code = `HTTP_${status}`,
  ) {
    super(`Telegram delivery failed with status ${status}`);
  }
}
