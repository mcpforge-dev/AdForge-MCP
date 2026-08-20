import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createLogger } from "@holymedia/observability";

type RequestWithId = FastifyRequest & { requestId?: string };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = createLogger("holymedia-mcp-v2-api");

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const reply = context.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = request.requestId ?? "unknown";
    const response =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof response === "string"
        ? response
        : status < 500
          ? "Request failed."
          : "Internal server error.";
    const code = status < 500 ? "request_invalid" : "internal_error";

    this.logger.error(
      {
        status,
        requestId,
        errorType:
          exception instanceof Error ? exception.constructor.name : "unknown",
      },
      "request failed",
    );
    reply.status(status).send({ error: { code, message, requestId } });
  }
}
