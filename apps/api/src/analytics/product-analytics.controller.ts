import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { CurrentPrincipal, RequirePermissions } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import { RecordProductEventDto } from "./product-analytics.dto.js";
import { ProductAnalyticsService } from "./product-analytics.service.js";

@Controller("workspaces/:id/analytics")
@UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
export class ProductAnalyticsController {
  public constructor(
    @Inject(ProductAnalyticsService)
    private readonly analytics: ProductAnalyticsService,
  ) {}

  @Post("events")
  @RequirePermissions("analytics.events.write")
  public async record(
    @Param("id") workspaceId: string,
    @Body(new ValidationPipe({ expectedType: RecordProductEventDto }))
    input: RecordProductEventDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    await this.analytics.record({
      workspaceId,
      userId: principal.userId,
      eventName: input.event_name,
      ...(input.properties ? { properties: input.properties } : {}),
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
    return { accepted: true };
  }

  @Get("summary")
  @RequirePermissions("analytics.read")
  public summary(
    @Param("id") workspaceId: string,
    @Query("days", new ParseIntPipe({ optional: true })) days = 30,
  ) {
    return this.analytics.summary(workspaceId, days);
  }
}
