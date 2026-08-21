/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import { SiteAnalysisDto } from "./site-analysis.dto.js";
import { SiteAnalysisService } from "./site-analysis.service.js";

@Controller("workspaces/:id/site-analysis")
@UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
@RequirePermissions("connections.read")
export class SiteAnalysisController {
  public constructor(
    @Inject(SiteAnalysisService) private readonly analysis: SiteAnalysisService,
  ) {}

  @Post()
  public analyze(@Body() input: SiteAnalysisDto) {
    return this.analysis.analyze(input.url);
  }
}
