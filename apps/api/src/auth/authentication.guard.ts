import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { SessionService } from "./session.service.js";
import type { RequestWithAuth } from "./auth.types.js";

@Injectable()
export class AuthenticationGuard implements CanActivate {
  public constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = this.sessions.extractToken(request);
    if (!token) throw new UnauthorizedException("Authentication required.");
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException("Authentication required.");
    request.user = {
      kind: "human",
      userId: session.userId,
      sessionId: session.id,
    };
    return true;
  }
}
