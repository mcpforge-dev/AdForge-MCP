import { timingSafeEqual } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import type { RequestWithAuth } from "./auth.types.js";
import { CSRF_COOKIE } from "./auth.types.js";

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly origins = loadConfig().corsOrigins;

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (
      ["GET", "HEAD", "OPTIONS"].includes(
        String(request.headers[":method"] ?? ""),
      )
    )
      return true;
    const method = String(
      (request as unknown as { method?: string }).method ?? "GET",
    ).toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

    const origin = this.header(request, "origin");
    if (origin && !this.origins.includes(origin)) {
      throw new ForbiddenException("CSRF validation failed.");
    }
    const cookieToken = request.cookies?.[CSRF_COOKIE];
    const headerToken = this.header(request, "x-csrf-token");
    if (!cookieToken || !headerToken || !sameToken(cookieToken, headerToken)) {
      throw new ForbiddenException("CSRF validation failed.");
    }
    return true;
  }

  private header(request: RequestWithAuth, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}

function sameToken(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
