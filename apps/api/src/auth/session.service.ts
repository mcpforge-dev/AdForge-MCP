import { Inject, Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { DatabaseService } from "../infrastructure/database.service.js";
import {
  createOpaqueToken,
  digestToken,
  hashIp,
  safeUserAgent,
} from "../infrastructure/security.utils.js";
import { SESSION_COOKIE } from "./auth.types.js";
import type { RequestWithAuth } from "./auth.types.js";

export type SessionRecord = {
  id: string;
  userId: string;
};

@Injectable()
export class SessionService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public async create(
    userId: string,
    request: RequestWithAuth,
  ): Promise<{ token: string; session: SessionRecord }> {
    const token = createOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.sessionTtlDays * 86_400_000,
    );
    const userAgent = safeUserAgent(this.header(request, "user-agent"));
    const ipHash = hashIp(request.ip, this.config.sessionHashSecret);
    const session = await this.database.client.session.create({
      data: {
        userId,
        tokenDigest: digestToken(token, this.config.sessionHashSecret),
        expiresAt,
        ...(userAgent ? { userAgent } : {}),
        ...(ipHash ? { ipHash } : {}),
      },
      select: { id: true, userId: true },
    });
    return { token, session };
  }

  public async validate(token: string): Promise<SessionRecord | null> {
    const session = await this.database.client.session.findUnique({
      where: { tokenDigest: digestToken(token, this.config.sessionHashSecret) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { status: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== "active"
    )
      return null;
    await this.database.client.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    return { id: session.id, userId: session.userId };
  }

  public async revoke(sessionId: string): Promise<void> {
    await this.database.client.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  public async revokeAll(
    userId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    await this.database.client.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  public extractToken(request: RequestWithAuth): string | undefined {
    return request.cookies?.[SESSION_COOKIE];
  }

  private header(request: RequestWithAuth, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
