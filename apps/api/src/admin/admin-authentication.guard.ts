import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { AdminService } from "./admin.service.js";
import type { RequestWithAuth } from "../auth/auth.types.js";

@Injectable()
export class AdminAuthenticationGuard implements CanActivate {
  public constructor(
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = this.admin.extractSessionToken(request);
    if (!token || !(await this.admin.validateSession(token))) {
      if (request.user?.kind === "human")
        throw new ForbiddenException("System admin access required.");
      throw new UnauthorizedException("Admin authentication required.");
    }
    return true;
  }
}
