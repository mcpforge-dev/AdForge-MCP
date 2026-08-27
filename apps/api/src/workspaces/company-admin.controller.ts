/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { UpdateCompanyAccessStatusDto } from "../auth/auth.dto.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceService, type WorkspaceView } from "./workspace.service.js";

@Controller("admin/companies")
@UseGuards(AuthenticationGuard)
export class CompanyAdminController {
  public constructor(
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
  ) {}

  @Patch(":id/access")
  public updateAccess(
    @Param("id") id: string,
    @Body() input: UpdateCompanyAccessStatusDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ): Promise<WorkspaceView> {
    return this.workspaces.updateCompanyAccessStatus(
      id,
      input,
      principal,
      request,
    );
  }
}
