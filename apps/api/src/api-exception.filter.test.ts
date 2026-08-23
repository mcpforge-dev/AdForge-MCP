import { BadRequestException, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./api-exception.filter.js";
import { RateLimitExceededError } from "./infrastructure/redis-rate-limit.service.js";

function createHost() {
  const reply = {
    send: vi.fn(),
    status: vi.fn(),
  };
  reply.status.mockReturnValue(reply);
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId: "request-123" }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  return { host, reply };
}

describe("ApiExceptionFilter", () => {
  it.each(["signup", "login"])(
    "maps the shared %s rate-limit error to a sanitized 429 contract",
    () => {
      const { host, reply } = createHost();

      new ApiExceptionFilter().catch(new RateLimitExceededError(), host);

      expect(reply.status).toHaveBeenCalledWith(429);
      expect(reply.send).toHaveBeenCalledWith({
        error: {
          code: "rate_limited",
          message: "Too many requests.",
          requestId: "request-123",
        },
      });
    },
  );

  it("keeps ordinary client errors on the existing request-invalid contract", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(new BadRequestException(), host);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "request_invalid",
        message: "Request failed.",
        requestId: "request-123",
      },
    });
  });

  it("keeps unexpected errors on the existing 500 contract", () => {
    const { host, reply } = createHost();

    new ApiExceptionFilter().catch(new Error("secret internal detail"), host);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: "internal_error",
        message: "Internal server error.",
        requestId: "request-123",
      },
    });
  });
});
