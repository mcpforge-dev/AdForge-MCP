import { createLogger } from "@holymedia/observability";

type JsonObject = Record<string, unknown>;

type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  chat: { id: number };
  text?: string;
  reply_to_message?: { from?: { is_bot?: boolean } };
};

type TelegramUpdate = { update_id: number; message?: TelegramMessage };

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

type MpcResponse = {
  result?: { content?: Array<{ type?: string; text?: string }> };
  error?: { code?: number; message?: string };
};

export type HermesConfig = {
  enabled: boolean;
  botToken: string;
  mcpUrl: string;
  mcpToken: string;
  allowedChatIds: Set<number>;
  pollTimeoutSeconds: number;
};

export type HermesMcpClient = {
  callTool(name: string, arguments_: JsonObject): Promise<unknown>;
};

export function loadHermesConfig(
  source: NodeJS.ProcessEnv = process.env,
): HermesConfig {
  const list = (source.HERMES_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value));
  return {
    enabled: source.HERMES_ENABLED === "true",
    botToken: source.HERMES_TELEGRAM_BOT_TOKEN?.trim() ?? "",
    mcpUrl: source.HERMES_MCP_URL?.trim() || "http://127.0.0.1:4000/mcp",
    mcpToken: source.HERMES_MCP_TOKEN?.trim() ?? "",
    allowedChatIds: new Set(list),
    pollTimeoutSeconds: Math.min(
      Math.max(Number(source.HERMES_POLL_TIMEOUT_SECONDS ?? 25) || 25, 1),
      50,
    ),
  };
}

export function shouldHandleMessage(
  message: TelegramMessage,
  botUsername: string,
): boolean {
  if (!message.text) return false;
  const text = message.text.toLowerCase();
  const mention = botUsername
    ? text.includes(`@${botUsername.toLowerCase()}`)
    : false;
  const command = /^\/hermes(?:@\w+)?(?:\s|$)/i.test(message.text);
  const reply = message.reply_to_message?.from?.is_bot === true;
  return command || mention || reply;
}

export function queryText(message: TelegramMessage): string {
  return (message.text ?? "")
    .replace(/^\/hermes(?:@\w+)?\s*/i, "")
    .replace(/@\w+/g, "")
    .trim();
}

export function isWriteRequest(query: string): boolean {
  return /(увелич|уменьш|измен|созд|удал|постав|пауза|возобнов|перезапу|переимен|бюджет|ставк|кампан|объявлен)/i.test(
    query,
  );
}

function metricValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricMoney(
  value: unknown,
): { amount: number; currency: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as JsonObject;
  const amount = Number(row.amount);
  return Number.isFinite(amount)
    ? { amount, currency: typeof row.currency === "string" ? row.currency : "" }
    : null;
}

function formatNumber(value: number | null): string {
  return value === null
    ? "нет данных"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
        value,
      );
}

function formatMoney(value: unknown): string {
  const money = metricMoney(value);
  return money
    ? `${formatNumber(money.amount)}${money.currency ? ` ${money.currency}` : ""}`
    : "нет данных";
}

export function renderMetrics(result: JsonObject, label: string): string {
  const metrics = (
    result.metrics && typeof result.metrics === "object"
      ? result.metrics
      : result
  ) as JsonObject;
  const lines = [
    `Период: ${label}`,
    "",
    `Расход: ${formatMoney(metrics.spend)}`,
    `Показы: ${formatNumber(metricValue(metrics.impressions))}`,
    `Клики: ${formatNumber(metricValue(metrics.clicks))}`,
    `CTR: ${formatNumber(metricValue(metrics.ctr))}`,
    `Средняя стоимость клика: ${formatMoney(metrics.cpc)}`,
    `Конверсии: ${formatNumber(metricValue(metrics.conversions))}`,
    `Стоимость конверсии: ${formatMoney(metrics.costPerConversion)}`,
  ];
  return lines.join("\n");
}

export class TelegramClient {
  public constructor(private readonly token: string) {}

  public async call<T>(method: string, body: JsonObject = {}): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined)
      throw new Error("Telegram request failed.");
    return payload.result;
  }

  public getUpdates(
    offset: number,
    timeout: number,
  ): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    });
  }

  public sendMessage(message: TelegramMessage, text: string): Promise<unknown> {
    return this.call("sendMessage", {
      chat_id: message.chat.id,
      text: text.slice(0, 3900),
      ...(message.message_thread_id
        ? { message_thread_id: message.message_thread_id }
        : {}),
      reply_parameters: {
        message_id: message.message_id,
        allow_sending_without_reply: true,
      },
    });
  }

  public getMe(): Promise<{ username?: string }> {
    return this.call("getMe");
  }
}

export class McpHttpClient implements HermesMcpClient {
  private requestId = 0;

  public constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  public async callTool(
    name: string,
    arguments_: JsonObject,
  ): Promise<unknown> {
    const id = ++this.requestId;
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: arguments_ },
      }),
    });
    const payload = (await response.json()) as MpcResponse;
    if (!response.ok || payload.error)
      throw new Error("HolyMedia MCP request failed.");
    const text = payload.result?.content?.find(
      (item) => item.type === "text",
    )?.text;
    if (text) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    return payload.result ?? null;
  }
}

export class HermesGateway {
  private readonly logger = createLogger("holymedia-mcp-v2-hermes");
  private offset = 0;
  private readonly seen = new Set<number>();
  private botUsername = "";
  private stopped = false;

  public constructor(
    private readonly config: HermesConfig,
    private readonly telegram: TelegramClient,
    private readonly mcp: HermesMcpClient,
  ) {}

  public stop(): void {
    this.stopped = true;
  }

  public async run(): Promise<void> {
    this.botUsername = (await this.telegram.getMe()).username ?? "";
    while (!this.stopped) {
      const updates = await this.telegram.getUpdates(
        this.offset,
        this.config.pollTimeoutSeconds,
      );
      for (const update of updates) {
        this.offset = Math.max(this.offset, update.update_id + 1);
        if (this.seen.has(update.update_id)) continue;
        this.seen.add(update.update_id);
        if (this.seen.size > 1000)
          this.seen.delete(this.seen.values().next().value as number);
        await this.handle(update.message);
      }
    }
  }

  private async handle(message: TelegramMessage | undefined): Promise<void> {
    if (!message || !shouldHandleMessage(message, this.botUsername)) return;
    if (
      this.config.allowedChatIds.size &&
      !this.config.allowedChatIds.has(message.chat.id)
    )
      return;
    const query = queryText(message);
    let response: string;
    if (isWriteRequest(query)) {
      response =
        "Гермес работает только в режиме чтения и не изменяет рекламные кампании.";
    } else {
      try {
        response = await this.answer(query);
      } catch {
        response =
          "Не удалось получить данные рекламного кабинета. Проверьте подключение и повторите запрос.";
      }
    }
    await this.telegram.sendMessage(message, response);
  }

  private async answer(query: string): Promise<string> {
    const accounts = (await this.mcp.callTool(
      "list_accounts",
      {},
    )) as Array<JsonObject>;
    const account = accounts[0];
    if (!account)
      return "В разрешённом рекламном кабинете пока нет доступных данных.";
    const provider = String(account.provider ?? "").toLowerCase();
    const accountId = String(account.account_id ?? "");
    const end = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const args = {
      provider,
      account_id: accountId,
      start_date: start,
      end_date: end,
    };
    const result = await this.mcp.callTool(
      /кампан|клик|конверс|расход|ctr|стоим|эффектив|показ/i.test(query)
        ? "get_performance_report"
        : "get_account_summary",
      args,
    );
    return renderMetrics(
      (result && typeof result === "object" ? result : {}) as JsonObject,
      `${start} — ${end}`,
    );
  }
}
