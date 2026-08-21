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
}

/** Compatibility facade for the original report skill download routes. */
@Controller("api/meta/skills")
@UseGuards(AuthenticationGuard)
export class LegacyReportController {
  public constructor(
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get("collect-report")
  public async report(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: LegacyReportQuery,
  ) {
    return this.reports.performance(
      await this.workspaceId(principal),
      this.input(query),
    );
  }

  @Post("collect-report")
  public async reportPost(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: LegacyReportBody,
  ) {
    return this.reports.performance(
      await this.workspaceId(principal),
      this.input(body),
    );
  }

  @Get("collect-report.docx")
  public async reportDocx(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: LegacyReportQuery,
    @Res() reply: FastifyReply,
  ) {
    const report = await this.reports.performanceDocx(
      await this.workspaceId(principal),
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
    const report = await this.reports.performanceDocx(
      await this.workspaceId(principal),
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
    if (!accountId || !startDate || !endDate) {
      throw new BadRequestException(
        "account_id, start_date and end_date are required.",
      );
    }
    return { accountId, startDate, endDate };
  }
}
