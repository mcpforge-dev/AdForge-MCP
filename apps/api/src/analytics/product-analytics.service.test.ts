import { describe, expect, it } from "vitest";
import { sanitizeProperties } from "./product-analytics.service.js";

describe("product analytics safety", () => {
  it("keeps only bounded scalar product context", () => {
    expect(
      sanitizeProperties({ provider: "META_ADS", step: 2, success: true }),
    ).toEqual({ provider: "META_ADS", step: 2, success: true });
  });

  it.each(["access_token", "client_secret", "account_id", "email"])(
    "rejects sensitive property %s",
    (key) => {
      expect(() => sanitizeProperties({ [key]: "hidden" })).toThrow(
        "Unsafe analytics property.",
      );
    },
  );

  it("rejects nested values and unbounded strings", () => {
    expect(() => sanitizeProperties({ nested: { unsafe: true } })).toThrow();
    expect(() => sanitizeProperties({ label: "x".repeat(161) })).toThrow();
  });
});
