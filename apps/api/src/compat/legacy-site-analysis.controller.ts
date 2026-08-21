import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { SiteAnalysisService } from "../site-analysis/site-analysis.service.js";

@Controller("api/site")
@UseGuards(AuthenticationGuard)
export class LegacySiteAnalysisController {
  public constructor(
    @Inject(SiteAnalysisService) private readonly analysis: SiteAnalysisService,
  ) {}

  @Get("analyze")
  public analyze(
    @CurrentPrincipal() _principal: HumanPrincipal,
    @Query("url") url?: string,
  ) {
    if (!url) throw new BadRequestException("url is required.");
    return this.analysis.analyze(url);
  }
}
