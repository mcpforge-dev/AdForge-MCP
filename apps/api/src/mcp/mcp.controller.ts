import {
  Controller,
  Get,
  Inject,
  MethodNotAllowedException,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { McpService } from "./mcp.service.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import { BillingService } from "../billing/billing.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ProviderError } from "../providers/provider.errors.js";
import { createLogger } from "@holymedia/observability";

type McpRequest = FastifyRequest & { body?: unknown };
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

@Controller()
export class McpController {
  private readonly logger = createLogger("holymedia-mcp-v2-mcp");

  public constructor(
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("mcp")
  public async get(@Req() request: McpRequest) {
    const rawAuthorization = request.headers.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;
    const token = bearerToken(authorization);
    const principal = token ? await this.tokens.authenticate(token) : null;
    if (!principal) {
      this.logger.warn(
        { authReason: "missing_invalid_revoked_or_expired_service_token" },
        "MCP authorization rejected",
      );
      throw new UnauthorizedException("MCP authorization required.");
    }

    // Server-to-client SSE is optional in Streamable HTTP. A valid MCP client
    // continues with JSON-RPC POST requests after this explicit response.
    throw new MethodNotAllowedException(
      "This MCP endpoint does not provide an SSE stream.",
    );
  }

  @Post("mcp")
  public async post(@Req() request: McpRequest) {
    const rawAuthorization = request.headers.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;
    const token = bearerToken(authorization);
    if (!token) {
      this.logger.warn(
        { authReason: "missing_or_malformed_bearer" },
        "MCP authorization rejected",
      );
      throw new UnauthorizedException("MCP authorization required.");
    }
    const principal = token ? await this.tokens.authenticate(token) : null;
    if (!principal) {
      this.logger.warn(
        { authReason: "invalid_revoked_or_expired_service_token" },
        "MCP authorization rejected",
      );
      throw new UnauthorizedException("MCP authorization required.");
    }

    const input = (request.body ?? {}) as JsonRpcRequest;
    const id = input.id ?? null;
    if (input.method === "notifications/initialized")
      return { status: "accepted" };
    if (input.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "holymedia-mcp-v2", version: "0.1.0" },
        },
      };
    }
    if (input.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: this.mcp.tools() } };
    }
    if (input.method === "tools/call") {
      const params = input.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      try {
        await this.billing.consumeMcpRequest(principal.workspaceId);
        const result = await this.mcp.call(principal, name, params.arguments);
        await Promise.allSettled([
          this.audit.record({
            eventType: "mcp_tool_executed",
            actorType: "SERVICE",
            workspaceId: principal.workspaceId,
            targetType: "mcp_tool",
            targetId: name.slice(0, 255),
            requestId: request.id,
            metadata: { tool: name.slice(0, 120) },
          }),
        ]);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        };
      } catch (error) {
        const message =
          error instanceof ProviderError &&
          error.code === "insufficient_permissions"
            ? "У подключения Meta недостаточно разрешений для этой операции."
            : "Запрос к рекламной платформе не выполнен.";
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ message }) }],
          },
        };
      }
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found." },
    };
  }
}

function bearerToken(authorization: string | undefined): string {
  // RFC 7235 authentication schemes are case-insensitive. This also rejects
  // malformed values such as "Bearer Bearer <token>" without logging a secret.
  const match = /^\s*Bearer\s+([^\s]+)\s*$/i.exec(authorization ?? "");
  return match?.[1] ?? "";
}
