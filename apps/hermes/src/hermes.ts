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

type Metrics = JsonObject;
type Campaign = JsonObject & { metrics?: JsonObject };

export type HermesConfig = {
  enabled: boolean;
  botToken: string;
  mcpUrl: string;
  mcpToken: string;
  allowedChatIds: Set<number>;
  chatAccountIds: Map<number, string>;
  pollTimeoutSeconds: number;
  openAiApiKey: string;
  openAiModel: string;
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
  const chatAccountIds = new Map<number, string>();
  for (const binding of (source.HERMES_CHAT_ACCOUNT_BINDINGS ?? "").split(",")) {
    const [chatId, accountId] = binding.split(":", 2).map((value) => value?.trim());
    const numericChatId = Number(chatId);
    if (Number.isSafeInteger(numericChatId) && accountId)
      chatAccountIds.set(numericChatId, accountId);
  }
  return {
    enabled: source.HERMES_ENABLED === "true",
    botToken: source.HERMES_TELEGRAM_BOT_TOKEN?.trim() ?? "",
    mcpUrl: source.HERMES_MCP_URL?.trim() || "http://127.0.0.1:4000/mcp",
    mcpToken: source.HERMES_MCP_TOKEN?.trim() ?? "",
    allowedChatIds: new Set(list),
    chatAccountIds,
    pollTimeoutSeconds: Math.min(
      Math.max(Number(source.HERMES_POLL_TIMEOUT_SECONDS ?? 25) || 25, 1),
      50,
    ),
    openAiApiKey: source.HERMES_OPENAI_API_KEY?.trim() ?? "",
    openAiModel: source.HERMES_OPENAI_MODEL?.trim() || "gpt-5-mini",
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
  return /(увелич(?:ь|ить)|уменьш(?:ь|ить)|измен(?:и|ить)|созда(?:й|ть)|удал(?:и|ить)|постав(?:ь|ить)|приостанов(?:и|ить)|возобнов(?:и|ить)|перезапуст(?:и|ить)|переимен(?:уй|овать)|increase|decrease|change|create|delete|pause|resume|rename)/i.test(
    query,
  );
}

export type HermesTextEnhancer = {
  enhance(deterministicText: string): Promise<string>;
};

export class OpenAiTextEnhancer implements HermesTextEnhancer {
  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  public async enhance(deterministicText: string): Promise<string> {
    if (!this.apiKey) return deterministicText;
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          instructions:
            "Rewrite the Russian advertising summary clearly and briefly. Preserve every number and fact exactly. Do not add causes, advice or new facts.",
          input: deterministicText,
        }),
      });
      if (!response.ok) return deterministicText;
      const payload = (await response.json()) as { output_text?: string };
      const enhanced = payload.output_text?.trim();
      if (!enhanced || !sameNumericFacts(deterministicText, enhanced))
        return deterministicText;
      return enhanced;
    } catch {
      return deterministicText;
    }
  }
}

function sameNumericFacts(source: string, candidate: string): boolean {
  const values = (text: string) =>
    text.match(/[-+]?\d[\d\s.,%]*/g)?.map((value) => value.replace(/\s/g, "")) ?? [];
  return JSON.stringify(values(source)) === JSON.stringify(values(candidate));
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function arrayValue(value: unknown): JsonObject[] {
  if (Array.isArray(value))
    return value.filter(
      (item) => item && typeof item === "object",
    ) as JsonObject[];
  const object = objectValue(value);
  return Array.isArray(object.items)
    ? (object.items.filter(
        (item) => item && typeof item === "object",
      ) as JsonObject[])
    : [];
}

function metricValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function metricMoney(
  value: unknown,
): { amount: number; currency: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as JsonObject;
  const amount = metricValue(row.amount);
  return amount === null
    ? null
    : {
        amount,
        currency: typeof row.currency === "string" ? row.currency : "",
      };
}

function numericMetric(metrics: Metrics, name: string): number | null {
  const value = metrics[name];
  const money = metricMoney(value);
  return money ? money.amount : metricValue(value);
}

function formatNumber(value: number | null): string {
  return value === null
    ? "нет данных"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
        value,
      );
}

function formatPercent(value: number | null): string {
  if (value === null) return "нет данных";
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${formatNumber(percent)}%`;
}

function formatMoney(value: unknown): string {
  const money = metricMoney(value);
  return money
    ? `${formatNumber(money.amount)}${money.currency ? ` ${money.currency}` : ""}`
    : "нет данных";
}

function dateLabel(start: string, end: string): string {
  return `${start} — ${end}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function completedRange(
  days = 7,
  offsetDays = 0,
): { start: string; end: string } {
  const end = new Date(Date.now() - (1 + offsetDays) * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { start: dateOnly(start), end: dateOnly(end) };
}

export function renderMetrics(result: JsonObject, label: string): string {
  const metrics = objectValue(
    result.metrics && typeof result.metrics === "object"
      ? result.metrics
      : result,
  );
  const lines = [
    `Период: ${label}`,
    "",
    `Расход: ${formatMoney(metrics.spend)}`,
    `Показы: ${formatNumber(numericMetric(metrics, "impressions"))}`,
    `Клики: ${formatNumber(numericMetric(metrics, "clicks"))}`,
    `CTR: ${formatPercent(numericMetric(metrics, "ctr"))}`,
    `Средняя стоимость клика: ${formatMoney(metrics.cpc)}`,
    `Конверсии: ${formatNumber(numericMetric(metrics, "conversions"))}`,
    `Стоимость конверсии: ${formatMoney(metrics.costPerConversion)}`,
  ];
  return lines.join("\n");
}

function delta(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "нет данных";
  const absolute = current - previous;
  const percent = previous === 0 ? null : (absolute / Math.abs(previous)) * 100;
  return `${absolute >= 0 ? "+" : ""}${formatNumber(absolute)}${percent === null ? "" : ` (${percent >= 0 ? "+" : ""}${formatNumber(percent)}%)`}`;
}

export function renderComparison(
  current: JsonObject,
  previous: JsonObject,
): string {
  const currentMetrics = objectValue(current.metrics);
  const previousMetrics = objectValue(previous.metrics);
  const rows: Array<[string, string]> = [
    [
      "Расход",
      delta(
        numericMetric(currentMetrics, "spend"),
        numericMetric(previousMetrics, "spend"),
      ),
    ],
    [
      "Показы",
      delta(
        numericMetric(currentMetrics, "impressions"),
        numericMetric(previousMetrics, "impressions"),
      ),
    ],
    [
      "Клики",
      delta(
        numericMetric(currentMetrics, "clicks"),
        numericMetric(previousMetrics, "clicks"),
      ),
    ],
    [
      "Конверсии",
      delta(
        numericMetric(currentMetrics, "conversions"),
        numericMetric(previousMetrics, "conversions"),
      ),
    ],
    [
      "CTR",
      delta(
        numericMetric(currentMetrics, "ctr"),
        numericMetric(previousMetrics, "ctr"),
      ),
    ],
    [
      "Стоимость конверсии",
      delta(
        numericMetric(currentMetrics, "costPerConversion"),
        numericMetric(previousMetrics, "costPerConversion"),
      ),
    ],
  ];
  return [
    "\nСравнение с предыдущим периодом:",
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
}

function campaignMetric(campaign: Campaign, name: string): number | null {
  return numericMetric(objectValue(campaign.metrics), name);
}

function campaignLeaders(campaigns: JsonObject[]): {
  spend: Campaign | null;
  clicks: Campaign | null;
  conversions: Campaign | null;
} {
  const sorted = (name: string) =>
    [...(campaigns as Campaign[])].sort(
      (left, right) =>
        (campaignMetric(right, name) ?? -1) -
        (campaignMetric(left, name) ?? -1),
    )[0] ?? null;
  return {
    spend: sorted("spend"),
    clicks: sorted("clicks"),
    conversions: sorted("conversions"),
  };
}

function campaignLine(
  label: string,
  campaign: Campaign | null,
  totalSpend: number | null,
): string {
  if (!campaign) return `${label}: нет данных`;
  const spend = campaignMetric(campaign, "spend");
  const share =
    spend !== null && totalSpend && totalSpend > 0
      ? `, доля расходов ${formatNumber((spend / totalSpend) * 100)}%`
      : "";
  return `${label}: ${String(campaign.name ?? campaign.id ?? "без названия")} (${formatMoney(objectValue(campaign.metrics).spend)}${share})`;
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
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.requestId,
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
  private readonly threadRanges = new Map<string, { days: number; offset: number }>();

  public constructor(
    private readonly config: HermesConfig,
    private readonly telegram: TelegramClient,
    private readonly mcp: HermesMcpClient,
    private readonly enhancer?: HermesTextEnhancer,
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
        response = await this.answer(query, message);
      } catch {
        response =
          "Не удалось получить данные рекламного кабинета. Проверьте подключение и повторите запрос.";
      }
    }
    await this.telegram.sendMessage(message, response);
  }

  private async answer(query: string, message: TelegramMessage): Promise<string> {
    const accounts = arrayValue(await this.mcp.callTool("list_accounts", {}));
    const boundAccountId = this.config.chatAccountIds.get(message.chat.id);
    const account = boundAccountId
      ? accounts.find(
          (item) =>
            item.account_id === boundAccountId || item.id === boundAccountId,
        )
      : accounts[0];
    if (!account)
      return "В разрешённом рекламном кабинете пока нет доступных данных.";
    const provider = String(account.provider ?? "").toLowerCase();
    const accountId = String(account.account_id ?? "");
    const compare =
      /(сравн|предыдущ|прошл|изменил|динамик|compare|previous|last week)/i.test(
        query,
      );
    const threadKey = `${message.chat.id}:${message.message_thread_id ?? 0}`;
    const priorContext = this.threadRanges.get(threadKey) ?? { days: 7, offset: 0 };
    const requestedDays = Number(query.match(/(?:за|последн\w*)\s+(\d{1,3})\s+д/i)?.[1] ?? 0);
    const asksPrevious = /предыдущ|прошл\w*\s+недел/i.test(query);
    const followUp = /^а\s+/i.test(query);
    const context = {
      days: requestedDays > 0 && requestedDays <= 90 ? requestedDays : priorContext.days,
      offset: asksPrevious ? 7 : followUp ? priorContext.offset : 0,
    };
    this.threadRanges.set(threadKey, context);
    const current = completedRange(context.days, context.offset);
    const previous = completedRange(context.days, context.offset + context.days);
    const args = (range: { start: string; end: string }) => ({
      provider,
      account_id: accountId,
      start_date: range.start,
      end_date: range.end,
    });
    const currentResult = objectValue(
      await this.mcp.callTool("get_performance_report", args(current)),
    );
    const campaigns = arrayValue(currentResult.campaigns);
    const currentMetrics = objectValue(currentResult.metrics);
    const onlyConversions = /только\s+конверс/i.test(query);
    const efficiencyMetrics = /(ctr|стоимост\w+\s+клик|стоимост\w+\s+конверс)/i.test(query);
    let output = onlyConversions
      ? [
          `Период: ${dateLabel(current.start, current.end)}`,
          `Конверсии: ${formatNumber(numericMetric(currentMetrics, "conversions"))}`,
          `Стоимость конверсии: ${formatMoney(currentMetrics.costPerConversion)}`,
        ].join("\n")
      : efficiencyMetrics
        ? [
            `Период: ${dateLabel(current.start, current.end)}`,
            `CTR: ${formatPercent(numericMetric(currentMetrics, "ctr"))}`,
            `Средняя стоимость клика: ${formatMoney(currentMetrics.cpc)}`,
            `Стоимость конверсии: ${formatMoney(currentMetrics.costPerConversion)}`,
          ].join("\n")
        : renderMetrics(currentResult, dateLabel(current.start, current.end));
    if (compare) {
      const previousResult = objectValue(
        await this.mcp.callTool("get_performance_report", args(previous)),
      );
      output += renderComparison(currentResult, previousResult);
      output +=
        "\n\nВывод: сравнение построено по данным HolyMedia MCP за два завершённых периода.";
    }
    const asksForLeader =
      /(какая|какой|лидир|больше всего|максималь|топ|кампани)/i.test(query);
    if (asksForLeader) {
      const leaders = campaignLeaders(campaigns);
      const totalSpend = numericMetric(
        objectValue(currentResult.metrics),
        "spend",
      );
      output += `\n\n${campaignLine("Больше всего расходов", leaders.spend, totalSpend)}`;
      if (/(клик|трафик)/i.test(query))
        output += `\n${campaignLine("Больше всего кликов", leaders.clicks, totalSpend)}`;
      if (/(конверс|результат)/i.test(query))
        output += `\n${campaignLine("Больше всего конверсий", leaders.conversions, totalSpend)}`;
    }
    if (!campaigns.length)
      output +=
        "\n\nЗамечание: за выбранный период кампании не вернули данных, поэтому вывод ограничен общими показателями.";
    return this.enhancer ? this.enhancer.enhance(output) : output;
  }
}
