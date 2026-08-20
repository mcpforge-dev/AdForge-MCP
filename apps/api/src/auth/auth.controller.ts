/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentPrincipal } from "./auth.decorators.js";
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
  VerifyEmailDto,
} from "./auth.dto.js";
import { AuthService } from "./auth.service.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { CookieService } from "./cookie.service.js";
import type { HumanPrincipal, RequestWithAuth } from "./auth.types.js";

@Controller("auth")
export class AuthController {
  public constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CookieService) private readonly cookies: CookieService,
  ) {}

  @Get("csrf")
  public csrf(@Res({ passthrough: true }) reply: FastifyReply): {
    csrfToken: string;
  } {
    return { csrfToken: this.cookies.setCsrf(reply) };
  }

  @Post("signup")
  public async signup(
    @Body() input: SignupDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.signup(input, request);
    this.cookies.setSession(reply, result.sessionToken);
    return { user: result.user, workspace: result.workspace };
  }

  @Post("login")
  public async login(
    @Body() input: LoginDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.login(input, request);
    this.cookies.setSession(reply, result.sessionToken);
    return { user: result.user, workspace: result.workspace };
  }

  @Post("forgot-password")
  public forgotPassword(
    @Body() input: ForgotPasswordDto,
    @Req() request: RequestWithAuth,
  ) {
    return this.auth.forgotPassword(input, request);
  }

  @Post("reset-password")
  public resetPassword(
    @Body() input: ResetPasswordDto,
    @Req() request: RequestWithAuth,
  ) {
    return this.auth.resetPassword(input, request);
  }

  @Post("verify-email")
  public verifyEmail(
    @Body() input: VerifyEmailDto,
    @Req() request: RequestWithAuth,
  ) {
    return this.auth.verifyEmail(input, request);
  }

  @UseGuards(AuthenticationGuard)
  @Post("logout")
  public async logout(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.auth.logout(principal, request);
    this.cookies.clear(reply);
    return { success: true };
  }

  @UseGuards(AuthenticationGuard)
  @Post("logout-all")
  public async logoutAll(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.auth.logoutAll(principal, request);
    this.cookies.clear(reply);
    return { success: true };
  }

  @UseGuards(AuthenticationGuard)
  @Get("session")
  public async session(@CurrentPrincipal() principal: HumanPrincipal) {
    return { user: await this.auth.currentUser(principal) };
  }

  @UseGuards(AuthenticationGuard)
  @Post("password/change")
  public async changePassword(
    @Body() input: ChangePasswordDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.changePassword(input, principal, request);
    this.cookies.setSession(reply, result.sessionToken);
    return { user: result.user };
  }
}
