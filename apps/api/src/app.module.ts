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
import { ProviderController } from "./providers/provider.controller.js";
import { CredentialVaultService } from "./providers/credential-vault.service.js";
import { OAuthStateService } from "./providers/oauth-state.service.js";
import { ProviderRefreshCoordinator } from "./providers/refresh-coordinator.service.js";
import { ProviderRegistry } from "./providers/provider.registry.js";
import { ProviderService } from "./providers/provider.service.js";
import { ProviderMetricsService } from "./providers/provider.metrics.js";
import { ServiceTokenController } from "./service-tokens/service-token.controller.js";
import { ServiceTokenService } from "./service-tokens/service-token.service.js";
import { McpController } from "./mcp/mcp.controller.js";
import { McpService } from "./mcp/mcp.service.js";
import {
  LegacyAuthController,
  LegacyMeController,
} from "./compat/legacy-auth.controller.js";
import { LegacyMcpTokenController } from "./compat/legacy-mcp-token.controller.js";
import { LegacyHostedController } from "./compat/legacy-hosted.controller.js";
import { ReportController } from "./reports/report.controller.js";
import { ReportService } from "./reports/report.service.js";
import { LegacyReportController } from "./compat/legacy-report.controller.js";
import { LegacySiteAnalysisController } from "./compat/legacy-site-analysis.controller.js";
import { SiteAnalysisController } from "./site-analysis/site-analysis.controller.js";
import { SiteAnalysisService } from "./site-analysis/site-analysis.service.js";
import { BillingController } from "./billing/billing.controller.js";
import { BillingService } from "./billing/billing.service.js";

@Module({
  controllers: [
    HealthController,
    AuthController,
    MeController,
    WorkspaceController,
    InvitationController,
    ProviderController,
    ServiceTokenController,
    McpController,
    LegacyAuthController,
    LegacyMeController,
    LegacyMcpTokenController,
    LegacyHostedController,
    ReportController,
    LegacyReportController,
    LegacySiteAnalysisController,
    SiteAnalysisController,
    BillingController,
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
    CredentialVaultService,
    OAuthStateService,
    ProviderRefreshCoordinator,
    ProviderRegistry,
    ProviderService,
    ProviderMetricsService,
    ServiceTokenService,
    McpService,
    ReportService,
    SiteAnalysisService,
    BillingService,
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
