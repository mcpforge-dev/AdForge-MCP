import { createParamDecorator, SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { RequestWithAuth } from "./auth.types.js";

export const REQUIRED_PERMISSIONS = "required_permissions";

export function RequirePermissions(...permissions: string[]) {
  return SetMetadata(REQUIRED_PERMISSIONS, permissions);
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    return request.user;
  },
);
