import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  CreateServiceTokenDto,
  RotateServiceTokenDto,
  UpdateServiceTokenScopesDto,
} from "./service-token.dto.js";
import { ServiceTokenController } from "./service-token.controller.js";

describe("ServiceTokenController validation metadata", () => {
  it("keeps service token DTOs available at runtime", () => {
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
    const updateScopesParameters = Reflect.getMetadata(
      "design:paramtypes",
      ServiceTokenController.prototype,
      "updateScopes",
    ) as unknown[];

    expect(createParameters[1]).toBe(CreateServiceTokenDto);
    expect(rotateParameters[2]).toBe(RotateServiceTokenDto);
    expect(updateScopesParameters[2]).toBe(UpdateServiceTokenScopesDto);
  });
});
