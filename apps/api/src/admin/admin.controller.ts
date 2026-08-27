/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CookieService } from "../auth/cookie.service.js";
import type { RequestWithAuth } from "../auth/auth.types.js";
import { AdminAuthenticationGuard } from "./admin-authentication.guard.js";
import {
  AdminAccessStatusDto,
  AdminCompanyQueryDto,
  AdminEntitlementDto,
  AdminInvitationActionDto,
  AdminLoginDto,
  AdminPlanDto,
  AdminSupportStatusDto,
  AdminUserStatusDto,
} from "./admin.dto.js";
import { AdminService } from "./admin.service.js";

@Controller("admin")
export class AdminController {
  public constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(CookieService) private readonly cookies: CookieService,
  ) {}

  @Post("auth/login")
  public async login(
    @Body() input: AdminLoginDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.admin.login(input, request);
    this.cookies.setAdminSession(reply, result.token);
    return { authenticated: true };
  }

  @Post("auth/logout")
  public async logout(
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.admin.logout(
      this.admin.extractSessionToken(request),
      request,
    );
    this.cookies.clearAdminSession(reply);
    return result;
  }

  @Get("session")
  public async session(@Req() request: RequestWithAuth) {
    const token = this.admin.extractSessionToken(request);
    return {
      authenticated: Boolean(
        token && (await this.admin.validateSession(token)),
      ),
    };
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("overview")
  public overview(): Promise<unknown> {
    return this.admin.overview();
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("companies")
  public companies(@Query() query: AdminCompanyQueryDto): Promise<unknown> {
    return this.admin.companies(query);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("companies/:id")
  public company(@Param("id") id: string): Promise<unknown> {
    return this.admin.company(id);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Patch("companies/:id/access")
  public updateCompanyAccess(
    @Param("id") id: string,
    @Body() input: AdminAccessStatusDto,
    @Req() request: RequestWithAuth,
  ): Promise<unknown> {
    return this.admin.updateCompanyAccess(id, input, request);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Put("companies/:id/plan")
  public setPlan(
    @Param("id") id: string,
    @Body() input: AdminPlanDto,
    @Req() request: RequestWithAuth,
  ) {
    return this.admin.setPlan(id, input, request);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Put("companies/:id/entitlements")
  public setEntitlement(
    @Param("id") id: string,
    @Body() input: AdminEntitlementDto,
    @Req() request: RequestWithAuth,
  ) {
    return this.admin.setEntitlement(id, input, request);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("users")
  public users(
    @Query("q") q?: string,
    @Query("page") page?: string,
  ): Promise<unknown> {
    return this.admin.users({
      ...(q ? { q } : {}),
      ...(page ? { page: Number(page) } : {}),
    });
  }

  @UseGuards(AdminAuthenticationGuard)
  @Patch("users/:id/access")
  public updateUserAccess(
    @Param("id") id: string,
    @Body() input: AdminUserStatusDto,
    @Req() request: RequestWithAuth,
  ) {
    return this.admin.updateUserAccess(id, input, request);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Post("invitations/:id")
  public invitation(
    @Param("id") id: string,
    @Body() input: AdminInvitationActionDto,
    @Req() request: RequestWithAuth,
  ) {
    return this.admin.invitation(id, input, request);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("plans")
  public plans() {
    return this.admin.plans();
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("diagnostics")
  public diagnostics(): Promise<unknown> {
    return this.admin.diagnostics();
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("support")
  public support(): Promise<unknown> {
    return this.admin.support();
  }

  @UseGuards(AdminAuthenticationGuard)
  @Patch("support/:id")
  public updateSupport(
    @Param("id") id: string,
    @Body() input: AdminSupportStatusDto,
    @Req() request: RequestWithAuth,
  ): Promise<unknown> {
    return this.admin.updateSupport(id, input, request);
  }

  @UseGuards(AdminAuthenticationGuard)
  @Get("audit")
  public audit(@Query("page") page?: string): Promise<unknown> {
    return this.admin.auditLog(page ? Number(page) : 1);
  }
}
