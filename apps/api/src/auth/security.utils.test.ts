import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  digestToken,
  normalizeEmail,
} from "../infrastructure/security.utils.js";

describe("identity security primitives", () => {
  it("normalizes email consistently", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });

  it("creates opaque tokens and stores only deterministic digests", () => {
    const token = createOpaqueToken();
    const digest = digestToken(token, "test-secret");
    expect(token).toHaveLength(43);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
    expect(digestToken(token, "test-secret")).toBe(digest);
    expect(digestToken(token, "other-secret")).not.toBe(digest);
  });
});
