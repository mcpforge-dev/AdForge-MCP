import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { RequirePermissions } from "../auth/auth.decorators.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import type { PerformanceReportDto } from "./report.dto.js";
import { ReportService, type PerformanceReport } from "./report.service.js";

@Controller("workspaces/:id/reports")
@UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
@RequirePermissions("provider_accounts.read")
export class ReportController {
  public constructor(
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  @Get("performance")
  public performance(
    @Param("id") workspaceId: string,
    @Query() input: PerformanceReportDto,
  ): Promise<PerformanceReport> {
    return this.reports.performance(workspaceId, input);
  }

  @Get("performance.docx")
  public async performanceDocx(
    @Param("id") workspaceId: string,
    @Query() input: PerformanceReportDto,
    @Res() reply: FastifyReply,
  ) {
    const report = await this.reports.performanceDocx(workspaceId, input);
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header(
        "content-disposition",
        "attachment; filename=holymedia-performance-report.docx",
      )
      .send(report);
  }
}
