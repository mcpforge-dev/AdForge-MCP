import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Redirect,
  Req,
  Res,
} from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import type { FastifyReply } from "fastify";
import { AuthService } from "../auth/auth.service.js";
import {
  GOOGLE_LOGIN_STATE_COOKIE,
  GoogleLoginService,
} from "../auth/google-login.service.js";
import { CookieService } from "../auth/cookie.service.js";
import type { RequestWithAuth } from "../auth/auth.types.js";

/** V1 Google Login paths retained for the in-place V2 cutover. */
@Controller("auth/google")
export class LegacyGoogleLoginController {
  private readonly config = loadConfig();

  public constructor(
    @Inject(GoogleLoginService) private readonly google: GoogleLoginService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CookieService) private readonly cookies: CookieService,
  ) {}

  @Get("start")
  @Redirect()
  public async start(
    @Query("oauth_transaction") oauthTransaction: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.google.start(
      oauthTransaction
        ? `/oauth/authorize/continue?transaction=${encodeURIComponent(oauthTransaction)}`
        : undefined,
    );
    reply.setCookie(GOOGLE_LOGIN_STATE_COOKIE, result.state, {
      ...this.cookieOptions(),
      httpOnly: true,
      maxAge: this.google.stateTtlSeconds(),
    });
    return { url: result.authorizationUrl, statusCode: 302 };
  }

  @Get("callback")
  @Redirect()
  public async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (error || !code || !state) {
      throw new BadRequestException("Google Login was not completed.");
    }
    if (
      !this.google.stateMatchesCookie(
        state,
        request.cookies?.[GOOGLE_LOGIN_STATE_COOKIE],
      )
    ) {
      throw new BadRequestException("Google Login session is invalid.");
    }
    const stateResult = await this.google.consumeState(state);
    const profile = await this.google.exchangeCode(code);
    const result = await this.auth.loginWithGoogle(profile, request);
    this.cookies.setSession(reply, result.sessionToken);
    reply.clearCookie(GOOGLE_LOGIN_STATE_COOKIE, this.cookieOptions());
    return {
      url: result.onboardingRequired ? "/onboarding" : stateResult.nextPath,
      statusCode: 302,
    };
  }

  private cookieOptions() {
    return {
      path: "/",
      secure:
        this.config.environment !== "development" &&
        this.config.environment !== "test",
      sameSite: "lax" as const,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
    };
  }
}
