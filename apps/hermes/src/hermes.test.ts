import { describe, expect, it } from "vitest";
import {
  completedRange,
  isWriteRequest,
  loadHermesConfig,
  OpenAiTextEnhancer,
  queryText,
  renderComparison,
  renderMetrics,
  shouldHandleMessage,
  validateHermesConfig,
} from "./hermes.js";

describe("Hermes deterministic gateway", () => {
  it("accepts command, mention and replies but ignores ordinary messages", () => {
    expect(
      shouldHandleMessage(
        { message_id: 1, chat: { id: 1 }, text: "/hermes расход" },
        "hermes_bot",
      ),
    ).toBe(true);
    expect(
      shouldHandleMessage(
        { message_id: 2, chat: { id: 1 }, text: "@hermes_bot покажи CTR" },
        "hermes_bot",
      ),
    ).toBe(true);
    expect(
      shouldHandleMessage(
        {
          message_id: 3,
          chat: { id: 1 },
          text: "обычное сообщение",
          reply_to_message: { from: { is_bot: true } },
        },
        "hermes_bot",
      ),
    ).toBe(true);
    expect(
      shouldHandleMessage(
        { message_id: 4, chat: { id: 1 }, text: "обычное сообщение" },
        "hermes_bot",
      ),
    ).toBe(false);
  });

  it("strips command and rejects writes before MCP", () => {
    expect(
      queryText({
        message_id: 1,
        chat: { id: 1 },
        text: "/hermes@hermes_bot сколько потратили?",
      }),
    ).toBe("сколько потратили?");
    expect(isWriteRequest("увеличь бюджет кампании на 20%")).toBe(true);
    expect(isWriteRequest("покажи расход за неделю")).toBe(false);
    expect(isWriteRequest("какая кампания потратила больше всего?")).toBe(
      false,
    );
  });

  it("formats only returned metrics and does not invent missing values", () => {
    const output = renderMetrics(
      {
        metrics: {
          spend: { amount: "12.5", currency: "USD" },
          impressions: 1000,
          clicks: 25,
          ctr: 0.025,
          cpc: { amount: "0.5", currency: "USD" },
          conversions: null,
          costPerConversion: null,
        },
      },
      "2026-01-01 — 2026-01-07",
    );
    expect(output).toContain("12,5 USD");
    expect(output).toContain("CTR: 2,5%");
    expect(output).toContain("нет данных");
  });

  it("renders absolute and percentage period changes", () => {
    const output = renderComparison(
      { metrics: { spend: { amount: "150", currency: "USD" }, clicks: 120 } },
      { metrics: { spend: { amount: "100", currency: "USD" }, clicks: 100 } },
    );
    expect(output).toContain("Расход: +50 (+50%)");
    expect(output).toContain("Клики: +20 (+20%)");
  });

  it("returns completed ranges and supports a previous period", () => {
    const current = completedRange();
    const previous = completedRange(7, 7);
    expect(current.end < new Date().toISOString().slice(0, 10)).toBe(true);
    expect(previous.end < current.start).toBe(true);
  });

  it("keeps scoped configuration server-side", () => {
    const config = loadHermesConfig({
      HERMES_ENABLED: "true",
      HERMES_TELEGRAM_BOT_TOKEN: "bot-secret",
      HERMES_MCP_TOKEN: "hmst_secret",
      HERMES_ALLOWED_CHAT_IDS: "123, 456",
      HERMES_CHAT_ACCOUNT_BINDINGS: "123:account-a,456:account-b",
    });
    expect(config.enabled).toBe(true);
    expect(config.allowedChatIds).toEqual(new Set([123, 456]));
    expect(config.mcpUrl).toBe("http://127.0.0.1:4000/mcp");
    expect(config.chatAccountIds.get(123)).toBe("account-a");
  });

  it("requires a chat allowlist when enabled", () => {
    const config = loadHermesConfig({
      HERMES_ENABLED: "true",
      HERMES_TELEGRAM_BOT_TOKEN: "bot-secret",
      HERMES_MCP_TOKEN: "hmst_secret",
    });
    expect(validateHermesConfig(config)).toContain("HERMES_ALLOWED_CHAT_IDS");
  });

  it("accepts an enabled scoped configuration", () => {
    const config = loadHermesConfig({
      HERMES_ENABLED: "true",
      HERMES_TELEGRAM_BOT_TOKEN: "bot-secret",
      HERMES_MCP_TOKEN: "hmst_secret",
      HERMES_ALLOWED_CHAT_IDS: "123",
      HERMES_MCP_URL: "https://mcp.example.test/mcp",
    });
    expect(validateHermesConfig(config)).toBeNull();
  });

  it("falls back to deterministic text when OpenAI is unavailable", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("quota", { status: 429 });
    try {
      const enhancer = new OpenAiTextEnhancer("test-key", "test-model");
      await expect(enhancer.enhance("Расход: 100 USD")).resolves.toBe(
        "Расход: 100 USD",
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
