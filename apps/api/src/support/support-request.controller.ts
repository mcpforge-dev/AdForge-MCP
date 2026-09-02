import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { RequestWithAuth } from "../auth/auth.types.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
// Nest reads this class from runtime reflection for the global ValidationPipe.
// Keep this as a value import rather than `import type`.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateSupportRequestDto } from "./support-request.dto.js";
import { SupportRequestService } from "./support-request.service.js";

@Controller("workspaces/:id/support-requests")
@UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
export class SupportRequestController {
  public constructor(
    @Inject(SupportRequestService)
    private readonly support: SupportRequestService,
  ) {}

  @Post()
  @RequirePermissions("workspace.read")
  public create(
    @Param("id") workspaceId: string,
    @Body() input: CreateSupportRequestDto,
    @Req() request: RequestWithAuth,
  ): Promise<unknown> {
    return this.support.create(workspaceId, input, request);
  }
}
