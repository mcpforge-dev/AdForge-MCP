import {
  Body,
  Controller,
  ConflictException,
  Inject,
  Param,
  Post,
  Req,
  Res,
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
import {
  SupportDeliveryPending,
  SupportRequestService,
} from "./support-request.service.js";
import type { FastifyReply } from "fastify";

@Controller("workspaces/:id/support-requests")
@UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
export class SupportRequestController {
  public constructor(
    @Inject(SupportRequestService)
    private readonly support: SupportRequestService,
  ) {}

  @Post()
  @RequirePermissions("workspace.read")
  public async create(
    @Param("id") workspaceId: string,
    @Body() input: CreateSupportRequestDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    try {
      return await this.support.create(workspaceId, input, request);
    } catch (error) {
      if (error instanceof ConflictException) {
        reply.code(409);
        return {
          error: {
            message:
              "Этот запрос связан с другим сообщением. Отправьте изменённое сообщение как новую заявку.",
          },
        };
      }
      if (!(error instanceof SupportDeliveryPending)) throw error;
      reply.code(202);
      return { telegramDelivered: false, deliveryStatus: "pending" };
    }
  }
}
