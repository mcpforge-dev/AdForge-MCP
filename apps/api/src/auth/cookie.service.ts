import { Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import type { FastifyReply } from "fastify";
import { createOpaqueToken } from "../infrastructure/security.utils.js";
import {
  ADMIN_SESSION_COOKIE,
  CSRF_COOKIE,
  SESSION_COOKIE,
} from "./auth.types.js";

type CookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "lax" | "none" | "strict" | boolean;
  secure?: boolean | "auto";
  signed?: boolean;
};

type CookieCapableReply = FastifyReply & {
  setCookie(name: string, value: string, options?: CookieOptions): FastifyReply;
  clearCookie(name: string, options?: CookieOptions): FastifyReply;
};

export function cookieReply(reply: FastifyReply): CookieCapableReply {
  // @fastify/cookie is registered during bootstrap. Its published type
  // augmentation is not resolved by pnpm after Fastify's security override,
  // so keep the runtime contract explicit at this single boundary.
  return reply as CookieCapableReply;
}

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
    cookieReply(reply).setCookie(SESSION_COOKIE, sessionToken, {
      ...common,
      httpOnly: true,
      maxAge: this.config.sessionTtlDays * 86_400,
    });
    cookieReply(reply).setCookie(CSRF_COOKIE, csrfToken, {
      ...common,
      httpOnly: false,
      maxAge: this.config.sessionTtlDays * 86_400,
    });
    return csrfToken;
  }

  public setCsrf(reply: FastifyReply): string {
    const csrfToken = createOpaqueToken();
    cookieReply(reply).setCookie(
      CSRF_COOKIE,
      csrfToken,
      this.cookieOptions(false),
    );
    return csrfToken;
  }

  public clear(reply: FastifyReply): void {
    cookieReply(reply).clearCookie(SESSION_COOKIE, this.cookieOptions(true));
    cookieReply(reply).clearCookie(CSRF_COOKIE, this.cookieOptions(false));
  }

  public setAdminSession(reply: FastifyReply, sessionToken: string): void {
    cookieReply(reply).setCookie(ADMIN_SESSION_COOKIE, sessionToken, {
      ...this.cookieOptions(true),
      path: "/api/v1/admin",
      sameSite: "strict",
      maxAge: this.config.adminSessionTtlHours * 3_600,
    });
  }

  public clearAdminSession(reply: FastifyReply): void {
    cookieReply(reply).clearCookie(ADMIN_SESSION_COOKIE, {
      ...this.cookieOptions(true),
      path: "/api/v1/admin",
      sameSite: "strict",
    });
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
