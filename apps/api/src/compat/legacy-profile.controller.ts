/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { UpdateProfileDto } from "../auth/auth.dto.js";
import { AuthService } from "../auth/auth.service.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";

/** Compatibility facade for the V1 account profile endpoints. */
@Controller("api/profile")
@UseGuards(AuthenticationGuard)
export class LegacyProfileController {
  public constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  public async get(@CurrentPrincipal() principal: HumanPrincipal) {
    return { profile: await this.auth.currentUser(principal) };
  }

  @Put()
  public async update(
    @Body() input: UpdateProfileDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return {
      profile: await this.auth.updateProfile(principal, input.name, request),
    };
  }
}
