import { Controller, Get, HttpCode, HttpStatus, Inject } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@holymedia/contracts";
import { ReadinessService } from "./readiness.service.js";

@Controller()
export class HealthController {
  public constructor(
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
  ) {}

  @Get("health")
  @HttpCode(HttpStatus.OK)
  public health(): HealthResponse {
    return {
      status: "ok",
      service: "holymedia-mcp-v2-api",
      version: "foundation-1",
    };
  }

  @Get("ready")
  public async ready(): Promise<ReadinessResponse> {
    return this.readiness.check();
  }
}
