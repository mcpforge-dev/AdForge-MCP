import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseService } from "../infrastructure/database.service.js";
import { REQUIRED_PERMISSIONS } from "./auth.decorators.js";
import type { RequestWithAuth } from "./auth.types.js";

@Injectable()
export class WorkspaceAuthorizationGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = request.user;
    const workspaceId = request.params?.id;
    if (!user || !workspaceId)
      throw new ForbiddenException("Workspace access denied.");
    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const membership =
      await this.database.client.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: user.userId } },
        select: {
          role: true,
          workspace: { select: { id: true, name: true, slug: true } },
        },
      });
    if (!membership) throw new ForbiddenException("Workspace access denied.");
    const links = await this.database.client.rolePermission.findMany({
      where: { role: membership.role },
      select: { permission: { select: { key: true } } },
    });
    const permissions = new Set(links.map((link) => link.permission.key));
    if (required.some((permission) => !permissions.has(permission))) {
      throw new ForbiddenException("Permission denied.");
    }
    return true;
  }
}
