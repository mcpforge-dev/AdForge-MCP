import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { SupportRequestController } from "./support-request.controller.js";
import { CreateSupportRequestDto } from "./support-request.dto.js";

describe("SupportRequestController validation metadata", () => {
  it("keeps the support request DTO available at runtime", () => {
    const parameters = Reflect.getMetadata(
      "design:paramtypes",
      SupportRequestController.prototype,
      "create",
    ) as unknown[];

    expect(parameters[1]).toBe(CreateSupportRequestDto);
  });
});
