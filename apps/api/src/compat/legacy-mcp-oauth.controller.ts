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
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { SessionService } from "../auth/session.service.js";
import { McpOAuthClientService } from "../mcp/mcp-oauth-client.service.js";
import { OAuthAuthorizationService } from "../mcp/oauth-authorization.service.js";

@Controller()
export class LegacyMcpOAuthController {
  public constructor(
    @Inject(McpOAuthClientService)
    private readonly clients: McpOAuthClientService,
    @Inject(OAuthAuthorizationService)
    private readonly oauth: OAuthAuthorizationService,
    @Inject(SessionService) private readonly sessions: SessionService,
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
  @Redirect()
  public async authorize(
    @Req() request: RequestWithAuth,
    @Query() query: Record<string, unknown>,
  ) {
    const clientId = typeof query.client_id === "string" ? query.client_id : "";
    const principal = await this.optionalPrincipal(request);
    if (await this.oauth.isPublicClient(clientId)) {
      return this.oauth.beginAuthorization(query, principal ?? undefined);
    }
    if (!principal) throw new UnauthorizedException("Authentication required.");
    return this.clients.authorize(query, principal);
  }

  @Post("oauth/register")
  public register(@Body() body: Record<string, unknown>) {
    return this.oauth.registerPublicClient(body);
  }

  @Get("oauth/authorize/continue")
  @UseGuards(AuthenticationGuard)
  public continueAuthorization(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query("transaction") transactionId: string,
    @Query("workspace_id") workspaceId?: string,
  ) {
    return this.oauth.continueAuthorization(
      transactionId,
      principal,
      workspaceId,
    );
  }

  @Post("oauth/authorize/consent")
  @UseGuards(AuthenticationGuard, CsrfGuard)
  @Redirect()
  public consent(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: Record<string, unknown>,
  ) {
    const transactionId =
      typeof body.transaction_id === "string" ? body.transaction_id : "";
    const workspaceId =
      typeof body.workspace_id === "string" ? body.workspace_id : undefined;
    return this.oauth.decideAuthorization(
      transactionId,
      body.decision === "allow",
      principal,
      workspaceId,
    );
  }

  @Post("oauth/token")
  public async token(
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    if (await this.oauth.isPublicClient(clientId)) {
      return this.oauth.exchangeAuthorizationCode(body);
    }
    return this.clients.token(body, authorization);
  }

  private async optionalPrincipal(
    request: RequestWithAuth,
  ): Promise<HumanPrincipal | null> {
    const token = this.sessions.extractToken(request);
    const session = token ? await this.sessions.validate(token) : null;
    return session
      ? { kind: "human", userId: session.userId, sessionId: session.id }
      : null;
  }
}
