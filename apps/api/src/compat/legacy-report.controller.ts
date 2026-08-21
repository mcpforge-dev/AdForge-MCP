import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Query,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { BillingService } from "../billing/billing.service.js";
import { ReportService } from "../reports/report.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";
import { IsDateString, IsOptional, IsString, MaxLength } from "class-validator";

type LegacyReportQuery = {
  account_id?: string;
  accountId?: string;
  start_date?: string;
  startDate?: string;
  end_date?: string;
  endDate?: string;
  previous_start_date?: string;
  previousStartDate?: string;
  previous_end_date?: string;
  previousEndDate?: string;
};

class LegacyReportBody {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public account_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public accountId?: string;

  @IsOptional()
  @IsDateString()
  public start_date?: string;

  @IsOptional()
  @IsDateString()
  public startDate?: string;

  @IsOptional()
  @IsDateString()
  public end_date?: string;

  @IsOptional()
  @IsDateString()
  public endDate?: string;

  @IsOptional()
  @IsDateString()
  public previous_start_date?: string;

  @IsOptional()
  @IsDateString()
  public previousStartDate?: string;

  @IsOptional()
  @IsDateString()
  public previous_end_date?: string;

  @IsOptional()
  @IsDateString()
  public previousEndDate?: string;
}

/** Compatibility facade for the original report skill download routes. */
@Controller("api/meta/skills")
@UseGuards(AuthenticationGuard)
export class LegacyReportController {
  public constructor(
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @Get("collect-report")
  public async report(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: LegacyReportQuery,
  ) {
    const workspaceId = await this.workspaceId(principal);
    await this.billing.requireFeature(workspaceId, "reports");
    return this.reports.performance(workspaceId, this.input(query));
  }

  @Post("collect-report")
  public async reportPost(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: LegacyReportBody,
  ) {
    const workspaceId = await this.workspaceId(principal);
    await this.billing.requireFeature(workspaceId, "reports");
    return this.reports.performance(workspaceId, this.input(body));
  }

  @Get("collect-report.docx")
  public async reportDocx(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: LegacyReportQuery,
    @Res() reply: FastifyReply,
  ) {
    const workspaceId = await this.workspaceId(principal);
    await this.billing.requireFeature(workspaceId, "reports");
    const report = await this.reports.performanceDocx(
      workspaceId,
      this.input(query),
    );
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header(
        "content-disposition",
        "attachment; filename=holymedia-monthly-ads-report.docx",
      )
      .send(report);
  }

  @Post("collect-report.docx")
  public async reportDocxPost(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: LegacyReportBody,
    @Res() reply: FastifyReply,
  ) {
    const workspaceId = await this.workspaceId(principal);
    await this.billing.requireFeature(workspaceId, "reports");
    const report = await this.reports.performanceDocx(
      workspaceId,
      this.input(body),
    );
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header(
        "content-disposition",
        "attachment; filename=holymedia-monthly-ads-report.docx",
      )
      .send(report);
  }

  private async workspaceId(principal: HumanPrincipal): Promise<string> {
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace)
      throw new BadRequestException("Workspace is not available.");
    return workspace.id;
  }

  private input(query: LegacyReportQuery | LegacyReportBody) {
    const accountId = query.account_id ?? query.accountId;
    const startDate = query.start_date ?? query.startDate;
    const endDate = query.end_date ?? query.endDate;
    const previousStartDate =
      query.previous_start_date ?? query.previousStartDate;
    const previousEndDate = query.previous_end_date ?? query.previousEndDate;
    if (!accountId || !startDate || !endDate) {
      throw new BadRequestException(
        "account_id, start_date and end_date are required.",
      );
    }
    return {
      accountId,
      startDate,
      endDate,
      ...(previousStartDate ? { previousStartDate } : {}),
      ...(previousEndDate ? { previousEndDate } : {}),
    };
  }
}
