import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { CurrentPrincipal } from "./auth.decorators.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { AuthService } from "./auth.service.js";
import type { HumanPrincipal } from "./auth.types.js";

@Controller("me")
@UseGuards(AuthenticationGuard)
export class MeController {
  public constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  public async get(@CurrentPrincipal() principal: HumanPrincipal) {
    return { user: await this.auth.currentUser(principal) };
  }
}
