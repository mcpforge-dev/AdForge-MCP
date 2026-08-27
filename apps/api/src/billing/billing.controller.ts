import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { RequestWithAuth } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import { BillingService } from "./billing.service.js";
import type { CreateTariffRequestDto } from "./billing.dto.js";

@Controller()
export class BillingController {
  public constructor(
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @Get("plans")
  public plans(): Promise<unknown> {
    return this.billing.listPlans();
  }

  @Get("workspaces/:id/billing/subscription")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("billing.read")
  public subscription(@Param("id") workspaceId: string): Promise<unknown> {
    return this.billing.currentSubscription(workspaceId);
  }

  @Post("workspaces/:id/billing/tariff-requests")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("billing.read")
  public createTariffRequest(
    @Param("id") workspaceId: string,
    @Body() input: CreateTariffRequestDto,
    @Req() request: RequestWithAuth,
  ): Promise<unknown> {
    return this.billing.createTariffRequest(
      workspaceId,
      input.planKey,
      request,
    );
  }

  @Get("workspaces/:id/billing/usage")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("billing.read")
  public usage(@Param("id") workspaceId: string): Promise<unknown> {
    return this.billing.usage(workspaceId);
  }

  @Get("workspaces/:id/billing/entitlements")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("billing.read")
  public entitlements(@Param("id") workspaceId: string): Promise<unknown> {
    return this.billing.entitlements(workspaceId);
  }
}
