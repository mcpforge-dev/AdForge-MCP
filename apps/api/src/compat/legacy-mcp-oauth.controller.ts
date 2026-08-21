import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { McpOAuthClientService } from "../mcp/mcp-oauth-client.service.js";

@Controller()
export class LegacyMcpOAuthController {
  public constructor(
    @Inject(McpOAuthClientService)
    private readonly clients: McpOAuthClientService,
  ) {}

  @Get("api/mcp-oauth-client")
  @UseGuards(AuthenticationGuard)
  public summary(@CurrentPrincipal() principal: HumanPrincipal) {
    return this.clients.summary(principal);
  }

  @Post("api/mcp-oauth-client/create")
  @UseGuards(AuthenticationGuard, CsrfGuard)
  public create(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
    @Body() body: Record<string, unknown>,
  ) {
    const name =
      typeof body.client_name === "string" ? body.client_name : undefined;
    return this.clients.create(principal, request, name);
  }

  @Get("oauth/authorize")
  @UseGuards(AuthenticationGuard)
  @Redirect()
  public authorize(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query() query: Record<string, unknown>,
  ) {
    return this.clients.authorize(query, principal);
  }

  @Post("oauth/token")
  public token(
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    return this.clients.token(body, authorization);
  }
}
