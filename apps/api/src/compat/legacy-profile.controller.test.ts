import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LegacyProfileController } from "./legacy-profile.controller.js";

const principal = { userId: "user-a" } as never;
const request = { ip: "127.0.0.1" } as never;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("legacy profile avatar compatibility", () => {
  it("accepts a small PNG and keeps bytes inside the profile boundary", async () => {
    const auth = {
      updateAvatar: vi.fn(async () => ({
        dataUrl: "data:image/png;base64,safe",
      })),
    };
    const controller = new LegacyProfileController(auth as never);

    await controller.updateAvatar(
      { dataUrl: `data:image/png;base64,${png.toString("base64")}` },
      principal,
      request,
    );

    expect(auth.updateAvatar).toHaveBeenCalledWith(
      principal,
      { data: png, mimeType: "image/png" },
      request,
    );
  });

  it("rejects content whose signature does not match its MIME type", async () => {
    const controller = new LegacyProfileController({} as never);
    await expect(
      controller.updateAvatar(
        {
          dataUrl: `data:image/png;base64,${Buffer.from("not-an-image").toString("base64")}`,
        },
        principal,
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
