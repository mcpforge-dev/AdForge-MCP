import {
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { McpService } from "./mcp.service.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import { BillingService } from "../billing/billing.service.js";
import { AuditService } from "../audit/audit.service.js";

type McpRequest = FastifyRequest & { body?: unknown };
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

@Controller()
export class McpController {
  public constructor(
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("mcp")
  public get() {
    throw new UnauthorizedException("MCP authorization required.");
  }

  @Post("mcp")
  public async post(@Req() request: McpRequest) {
    const rawAuthorization = request.headers.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";
    const principal = token ? await this.tokens.authenticate(token) : null;
    if (!principal)
      throw new UnauthorizedException("MCP authorization required.");

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
      } catch {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: "MCP tool request was rejected." }],
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
