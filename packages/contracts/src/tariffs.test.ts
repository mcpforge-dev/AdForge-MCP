import { describe, expect, it } from "vitest";
import { tariffPresentation } from "./tariffs.js";

describe("tariffPresentation", () => {
  it.each([
    ["ai_site_self", "AI Сайт", "AI Website", "Самостоятельно", "Self-service"],
    [
      "ai_ads_support",
      "AI Реклама",
      "AI Ads",
      "Расширенная поддержка",
      "Extended support",
    ],
    ["ai_seo_self", "AI SEO", "AI SEO", "Самостоятельно", "Self-service"],
    [
      "ai_marketing_support",
      "AI Marketing",
      "AI Marketing",
      "Расширенная поддержка",
      "Extended support",
    ],
  ])(
    "presents %s without exposing its storage key",
    (key, ru, en, ruLevel, enLevel) => {
      const result = tariffPresentation(key);
      expect(result.full.ru).toBe(`${ru} — ${ruLevel}`);
      expect(result.full.en).toBe(`${en} — ${enLevel}`);
    },
  );

  it("presents legacy internal access as lifetime access", () => {
    expect(tariffPresentation("legacy_internal")).toMatchObject({
      kind: "lifetime",
      plan: { ru: "Полный доступ", en: "Full access" },
      full: { ru: "Полный доступ / Бессрочно", en: "Full access / Lifetime" },
    });
  });

  it("does not expose unknown plan codes", () => {
    expect(tariffPresentation("future_internal_plan")).toMatchObject({
      kind: "unknown",
      full: { ru: "Не определён", en: "Not specified" },
    });
  });
});
