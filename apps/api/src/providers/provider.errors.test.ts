import { describe, expect, it } from "vitest";
import { ProviderError, toSafeProviderException } from "./provider.errors.js";

describe("provider error boundary", () => {
  it("does not expose provider error details", () => {
    const safe = toSafeProviderException(
      new ProviderError(
        "authorization_denied",
        "provider response contained a secret access token",
      ),
    );
    expect(safe.message).toBe("Провайдер отклонил авторизацию.");
    expect(safe.message).not.toContain("secret");
  });
});
