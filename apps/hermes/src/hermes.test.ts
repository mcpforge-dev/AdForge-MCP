import { describe, expect, it } from "vitest";
import {
  isWriteRequest,
  loadHermesConfig,
  queryText,
  renderMetrics,
  shouldHandleMessage,
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
    expect(output).toContain("нет данных");
  });

  it("keeps scoped configuration server-side", () => {
    const config = loadHermesConfig({
      HERMES_ENABLED: "true",
      HERMES_TELEGRAM_BOT_TOKEN: "bot-secret",
      HERMES_MCP_TOKEN: "hmst_secret",
      HERMES_ALLOWED_CHAT_IDS: "123, 456",
    });
    expect(config.enabled).toBe(true);
    expect(config.allowedChatIds).toEqual(new Set([123, 456]));
    expect(config.mcpUrl).toBe("http://127.0.0.1:4000/mcp");
  });
});
