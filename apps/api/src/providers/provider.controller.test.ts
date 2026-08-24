import { describe, expect, it, vi } from "vitest";
import { ProviderController } from "./provider.controller.js";

const request = { ip: "127.0.0.1" } as never;
const validState = "s".repeat(48);

function setup(
  completeOAuthCallback = vi.fn(async () => ({ id: "connection-a" })),
) {
  const providers = { completeOAuthCallback };
  const reply = {
    code: vi.fn(() => reply),
    redirect: vi.fn((location: string) => location),
  };
  return {
    controller: new ProviderController(providers as never),
    providers,
    reply,
  };
}

describe("provider OAuth callback UX", () => {
  it("accepts the validated state/code pair and returns to connections", async () => {
    const { controller, providers, reply } = setup();

    await controller.callback(
      "google",
      validState,
      "authorization-code",
      request,
      reply as never,
    );

    expect(providers.completeOAuthCallback).toHaveBeenCalledWith(
      "GOOGLE_ADS",
      { state: validState, code: "authorization-code" },
      request,
    );
    expect(reply.redirect).toHaveBeenCalledWith(
      "/dashboard?section=connections&oauth=success&provider=google",
    );
    expect(reply.code).toHaveBeenCalledWith(302);
  });

  it.each([
    ["meta", "META_ADS"],
    ["yandex", "YANDEX_DIRECT"],
    ["tiktok", "TIKTOK_ADS"],
  ])(
    "returns %s OAuth callbacks to the matching connections card",
    async (pathProvider, provider) => {
      const { controller, providers, reply } = setup();

      await controller.callback(
        pathProvider,
        validState,
        "authorization-code",
        request,
        reply as never,
      );

      expect(providers.completeOAuthCallback).toHaveBeenCalledWith(
        provider,
        { state: validState, code: "authorization-code" },
        request,
      );
      expect(reply.redirect).toHaveBeenCalledWith(
        `/dashboard?section=connections&oauth=success&provider=${pathProvider}`,
      );
    },
  );

  it("returns a safe dashboard error when provider completion fails", async () => {
    const { controller, reply } = setup(
      vi.fn(async () => {
        throw new Error("provider response must stay private");
      }),
    );

    await controller.callback(
      "google",
      validState,
      "authorization-code",
      request,
      reply as never,
    );

    expect(reply.redirect).toHaveBeenCalledWith(
      "/dashboard?section=connections&oauth=error&provider=google",
    );
    expect(reply.code).toHaveBeenCalledWith(302);
  });

  it("returns an actionable safe error for malformed callback values", async () => {
    const { controller, reply } = setup();
    await controller.callback("google", "short", "", request, reply as never);
    expect(reply.redirect).toHaveBeenCalledWith(
      "/dashboard?section=connections&oauth=error&provider=google",
    );
  });
});
