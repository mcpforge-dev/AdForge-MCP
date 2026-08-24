import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  CreateServiceTokenDto,
  RotateServiceTokenDto,
} from "./service-token.dto.js";
import { ServiceTokenController } from "./service-token.controller.js";

describe("ServiceTokenController validation metadata", () => {
  it("keeps the create and rotate DTOs available at runtime", () => {
    const createParameters = Reflect.getMetadata(
      "design:paramtypes",
      ServiceTokenController.prototype,
      "create",
    ) as unknown[];
    const rotateParameters = Reflect.getMetadata(
      "design:paramtypes",
      ServiceTokenController.prototype,
      "rotate",
    ) as unknown[];

    expect(createParameters[1]).toBe(CreateServiceTokenDto);
    expect(rotateParameters[2]).toBe(RotateServiceTokenDto);
  });
});
