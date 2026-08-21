/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Controller,
  Get,
  Inject,
  Param,
  NotFoundException,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import { ProviderService } from "../providers/provider.service.js";
import { SearchConsoleQueryDto } from "./search-console.dto.js";
import { WorkspaceService } from "../workspaces/workspace.service.js";

/** Search Console read API. The legacy route stays available for the V1 UI. */
@Controller()
export class SearchConsoleController {
  public constructor(
    @Inject(ProviderService) private readonly providers: ProviderService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Get("api/seo/search-console")
  @UseGuards(AuthenticationGuard)
  public async legacyReport(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: SearchConsoleQueryDto,
  ) {
    return this.providers.searchConsoleReport(
      await this.workspaceId(principal),
      query.site_url,
      query.days,
    );
  }

  @Get("workspaces/:id/seo/search-console")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public report(
    @Param("id") workspaceId: string,
    @Query() query: SearchConsoleQueryDto,
  ) {
    return this.providers.searchConsoleReport(
      workspaceId,
      query.site_url,
      query.days,
    );
  }

  private async workspaceId(principal: HumanPrincipal) {
    const workspace = (await this.workspaces.listForUser(principal))[0];
    if (!workspace) throw new NotFoundException("Workspace is not available.");
    return workspace.id;
  }
}
