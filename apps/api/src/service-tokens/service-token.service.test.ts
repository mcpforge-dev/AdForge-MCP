import { describe, expect, it } from "vitest";
import { hashServiceToken } from "./service-token.service.js";

describe("service token security primitives", () => {
  it("stores only a digest and never exposes the raw token", () => {
    const raw = "hmst_example-secret-value";
    const digest = hashServiceToken(raw);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(raw);
    expect(hashServiceToken(raw)).toBe(digest);
    expect(hashServiceToken(`${raw}-changed`)).not.toBe(digest);
  });
});
