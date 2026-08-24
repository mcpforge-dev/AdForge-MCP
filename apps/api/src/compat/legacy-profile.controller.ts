/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { UpdateAvatarDto, UpdateProfileDto } from "../auth/auth.dto.js";
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

  @Get("avatar")
  public avatar(@CurrentPrincipal() principal: HumanPrincipal) {
    return this.auth.currentAvatar(principal);
  }

  @Post("avatar")
  public async updateAvatar(
    @Body() input: UpdateAvatarDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    const parsed =
      /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        input.dataUrl,
      );
    if (!parsed?.[1] || !parsed[2])
      throw new BadRequestException("Use a JPEG, PNG or WebP image.");
    const data = Buffer.from(parsed[2], "base64");
    if (data.length === 0 || data.length > 2_097_152)
      throw new BadRequestException("Avatar must not exceed 2 MB.");
    if (!hasExpectedImageSignature(parsed[1], data))
      throw new BadRequestException("Invalid image file.");
    return this.auth.updateAvatar(
      principal,
      { data, mimeType: parsed[1] },
      request,
    );
  }
}

function hasExpectedImageSignature(mimeType: string, data: Buffer): boolean {
  if (mimeType === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8;
  if (mimeType === "image/png")
    return data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return (
    mimeType === "image/webp" &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  );
}
