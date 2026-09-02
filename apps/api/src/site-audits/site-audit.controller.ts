/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import { CreateSiteAuditDto, SiteAuditArtifactDto } from "./site-audit.dto.js";
import { SiteAuditService } from "./site-audit.service.js";

@Controller("workspaces/:id/site-audits")
@UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
@RequirePermissions("connections.read")
export class SiteAuditController {
  public constructor(private readonly audits: SiteAuditService) {}

  @Post()
  public create(
    @Param("id") workspaceId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: CreateSiteAuditDto,
  ) {
    return this.audits.create(workspaceId, principal.userId, body);
  }

  @Get()
  public list(@Param("id") workspaceId: string) {
    return this.audits.list(workspaceId);
  }

  @Get(":auditId")
  public get(
    @Param("id") workspaceId: string,
    @Param("auditId") auditId: string,
  ) {
    return this.audits.get(workspaceId, auditId);
  }

  @Get(":auditId/report.docx")
  public async report(
    @Param("id") workspaceId: string,
    @Param("auditId") auditId: string,
    @Res() reply: FastifyReply,
  ) {
    const item = await this.audits.report(workspaceId, auditId);
    reply
      .header("content-type", item.mimeType)
      .header(
        "content-disposition",
        "attachment; filename=HolyMedia-AI-site-audit.docx",
      )
      .send(item.data);
  }

  @Get(":auditId/screenshot")
  public async screenshot(
    @Param("id") workspaceId: string,
    @Param("auditId") auditId: string,
    @Query() query: SiteAuditArtifactDto,
    @Res() reply: FastifyReply,
  ) {
    const item = await this.audits.screenshot(workspaceId, auditId, query.kind);
    reply
      .header("content-type", item.mimeType)
      .header("cache-control", "private, no-store")
      .send(item.data);
  }
}
