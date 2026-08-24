import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ProviderController } from "./provider.controller.js";

const principal = { userId: "user-a" } as never;
const request = { ip: "127.0.0.1" } as never;
const validState = "s".repeat(48);

function setup(completeOAuth = vi.fn(async () => ({ id: "connection-a" }))) {
  const providers = { completeOAuth };
  const reply = { redirect: vi.fn((location: string) => location) };
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
      principal,
      request,
      reply as never,
    );

    expect(providers.completeOAuth).toHaveBeenCalledWith(
      "GOOGLE_ADS",
      { state: validState, code: "authorization-code" },
      principal,
      request,
    );
    expect(reply.redirect).toHaveBeenCalledWith(
      "/dashboard?section=connections&oauth=success&provider=google",
    );
  });

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
      principal,
      request,
      reply as never,
    );

    expect(reply.redirect).toHaveBeenCalledWith(
      "/dashboard?section=connections&oauth=error&provider=google",
    );
  });

  it("rejects malformed callback values", async () => {
    const { controller, reply } = setup();
    await expect(
      controller.callback(
        "google",
        "short",
        "",
        principal,
        request,
        reply as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
