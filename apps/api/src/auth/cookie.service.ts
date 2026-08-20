import { Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import type { FastifyReply } from "fastify";
import { createOpaqueToken } from "../infrastructure/security.utils.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "./auth.types.js";

@Injectable()
export class CookieService {
  private readonly config: AppConfig = loadConfig();

  public setSession(reply: FastifyReply, sessionToken: string): string {
    const csrfToken = createOpaqueToken();
    const common = {
      path: "/",
      secure:
        this.config.environment !== "development" &&
        this.config.environment !== "test",
      sameSite: "lax" as const,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
    };
    reply.setCookie(SESSION_COOKIE, sessionToken, {
      ...common,
      httpOnly: true,
      maxAge: this.config.sessionTtlDays * 86_400,
    });
    reply.setCookie(CSRF_COOKIE, csrfToken, {
      ...common,
      httpOnly: false,
      maxAge: this.config.sessionTtlDays * 86_400,
    });
    return csrfToken;
  }

  public setCsrf(reply: FastifyReply): string {
    const csrfToken = createOpaqueToken();
    reply.setCookie(CSRF_COOKIE, csrfToken, this.cookieOptions(false));
    return csrfToken;
  }

  public clear(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, this.cookieOptions(true));
    reply.clearCookie(CSRF_COOKIE, this.cookieOptions(false));
  }

  private cookieOptions(httpOnly: boolean) {
    return {
      path: "/",
      httpOnly,
      secure:
        this.config.environment !== "development" &&
        this.config.environment !== "test",
      sameSite: "lax" as const,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
    };
  }
}
