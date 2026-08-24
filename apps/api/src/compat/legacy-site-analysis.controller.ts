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
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { SiteAnalysisService } from "../site-analysis/site-analysis.service.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

@Controller("api/site")
@UseGuards(AuthenticationGuard)
export class LegacySiteAnalysisController {
  public constructor(
    @Inject(SiteAnalysisService) private readonly analysis: SiteAnalysisService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get("analyze")
  public async analyze(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query("url") url?: string,
  ) {
    if (!url) throw new BadRequestException("url is required.");
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace)
      throw new BadRequestException("Workspace is not available.");
    return this.analysis.analyze(
      { url },
      {
        workspaceId: workspace.id,
        userId: principal.userId,
      },
    );
  }

  @Get("history")
  public async history(@CurrentPrincipal() principal: HumanPrincipal) {
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace)
      throw new BadRequestException("Workspace is not available.");
    return this.analysis.history(workspace.id, principal.userId);
  }

  @Post("report.docx")
  public async reportDocx(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: { history_id?: string },
    @Res() reply: FastifyReply,
  ) {
    if (!body.history_id?.trim())
      throw new BadRequestException("history_id is required.");
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace)
      throw new BadRequestException("Workspace is not available.");
    const report = await this.analysis.reportDocx(
      workspace.id,
      principal.userId,
      body.history_id.trim(),
    );
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header(
        "content-disposition",
        "attachment; filename=HolyMedia-MCP-site-audit.docx",
      )
      .send(report);
  }
}
