import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditService } from "./audit/audit.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthenticationGuard } from "./auth/authentication.guard.js";
import { CookieService } from "./auth/cookie.service.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { EmailService } from "./auth/email.service.js";
import { MeController } from "./auth/me.controller.js";
import { PasswordService } from "./auth/password.service.js";
import { SessionService } from "./auth/session.service.js";
import { HealthController } from "./health.controller.js";
import { DatabaseService } from "./infrastructure/database.service.js";
import { RedisRateLimitService } from "./infrastructure/redis-rate-limit.service.js";
import { ReadinessService } from "./readiness.service.js";
import { InvitationController } from "./workspaces/invitation.controller.js";
import { WorkspaceAuthorizationGuard } from "./auth/workspace-authorization.guard.js";
import { WorkspaceController } from "./workspaces/workspace.controller.js";
import { WorkspaceService } from "./workspaces/workspace.service.js";

@Module({
  controllers: [
    HealthController,
    AuthController,
    MeController,
    WorkspaceController,
    InvitationController,
  ],
  providers: [
    DatabaseService,
    ReadinessService,
    AuditService,
    AuthService,
    AuthenticationGuard,
    CookieService,
    EmailService,
    PasswordService,
    SessionService,
    RedisRateLimitService,
    WorkspaceAuthorizationGuard,
    WorkspaceService,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
