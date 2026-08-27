import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import {
  TARIFF_PLANS,
  TARIFF_TRIAL_DAYS,
  tariffPlanByKey,
} from "@holymedia/contracts";
import { AuditService } from "../audit/audit.service.js";
import {
  ADMIN_SESSION_COOKIE,
  type RequestWithAuth,
} from "../auth/auth.types.js";
import { EmailService } from "../auth/email.service.js";
import { ReadinessService } from "../readiness.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisRateLimitService } from "../infrastructure/redis-rate-limit.service.js";
import {
  createOpaqueToken,
  digestToken,
  hashIp,
  safeUserAgent,
} from "../infrastructure/security.utils.js";
import type {
  AdminAccessStatusDto,
  AdminCompanyQueryDto,
  AdminEntitlementDto,
  AdminInvitationActionDto,
  AdminLoginDto,
  AdminPlanDto,
  AdminSupportStatusDto,
  AdminTariffRequestStatusDto,
  AdminTrialExtensionDto,
  AdminUserStatusDto,
} from "./admin.dto.js";

const PAGE_SIZE = 25;

@Injectable()
export class AdminService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EmailService) private readonly emails: EmailService,
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
    @Inject(RedisRateLimitService)
    private readonly limits: RedisRateLimitService,
  ) {}

  public extractSessionToken(request: RequestWithAuth): string | undefined {
    return request.cookies?.[ADMIN_SESSION_COOKIE];
  }

  public async login(input: AdminLoginDto, request: RequestWithAuth) {
    await this.limits.consume(
      `v2:rl:admin-login:ip:${hashIp(request.ip, this.config.sessionHashSecret) ?? "unknown"}`,
      5,
      900,
    );
    const valid = this.config.adminEnabled && this.passwordMatches(input);
    if (!valid) {
      await this.record("admin_login_failure", request, false, {
        reason: "invalid_credentials",
      });
      throw new UnauthorizedException("Invalid admin credentials.");
    }
    const token = createOpaqueToken();
    const userAgent = safeUserAgent(this.header(request, "user-agent"));
    const ipHash = hashIp(request.ip, this.config.sessionHashSecret);
    await this.database.client.adminSession.create({
      data: {
        tokenDigest: digestToken(token, this.config.sessionHashSecret),
        credentialFingerprint: this.credentialFingerprint(),
        expiresAt: new Date(
          Date.now() + this.config.adminSessionTtlHours * 3_600_000,
        ),
        ...(userAgent ? { userAgent } : {}),
        ...(ipHash ? { ipHash } : {}),
      },
    });
    await this.record("admin_login_success", request);
    return { token };
  }

  public async validateSession(token: string): Promise<boolean> {
    if (!this.config.adminEnabled) return false;
    const session = await this.database.client.adminSession.findUnique({
      where: { tokenDigest: digestToken(token, this.config.sessionHashSecret) },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        credentialFingerprint: true,
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !sameValue(session.credentialFingerprint, this.credentialFingerprint())
    ) {
      return false;
    }
    await this.database.client.adminSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    return true;
  }

  public async logout(token: string | undefined, request: RequestWithAuth) {
    if (token) {
      await this.database.client.adminSession.updateMany({
        where: {
          tokenDigest: digestToken(token, this.config.sessionHashSecret),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }
    await this.record("admin_logout", request);
    return { success: true };
  }

  public async overview(): Promise<unknown> {
    const [
      companies,
      users,
      connections,
      connectionErrors,
      latestAudit,
      support,
      ready,
    ] = await Promise.all([
      this.database.client.workspace.groupBy({
        by: ["accessStatus"],
        _count: { _all: true },
      }),
      this.database.client.user.count(),
      this.database.client.providerConnection.count({
        where: { status: "CONNECTED" },
      }),
      this.database.client.providerConnection.count({
        where: { status: { in: ["DEGRADED", "REAUTH_REQUIRED", "ERROR"] } },
      }),
      this.database.client.auditEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          eventType: true,
          success: true,
          workspaceId: true,
          createdAt: true,
        },
      }),
      this.database.client.manualConnectionRequest.findMany({
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { id: true, companyName: true, status: true, updatedAt: true },
      }),
      this.readiness.check().catch(() => null),
    ]);
    const count = (status: "PENDING" | "ACTIVE" | "SUSPENDED") =>
      companies.find((item) => item.accessStatus === status)?._count._all ?? 0;
    return {
      companies: {
        total: companies.reduce((sum, item) => sum + item._count._all, 0),
        pending: count("PENDING"),
        active: count("ACTIVE"),
        suspended: count("SUSPENDED"),
      },
      users,
      connections: { active: connections, attention: connectionErrors },
      health: {
        api: "ok",
        web: "not_probed",
        worker: "not_probed",
        postgres: ready?.dependencies.postgres?.status ?? "not_ready",
        redis: ready?.dependencies.redis?.status ?? "not_ready",
      },
      latestAudit,
      support,
    };
  }

  public async companies(query: AdminCompanyQueryDto): Promise<unknown> {
    const page = query.page ?? 1;
    const q = query.q?.trim();
    const where = {
      ...(query.status ? { accessStatus: query.status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { legalName: { contains: q, mode: "insensitive" as const } },
              {
                registrationNumber: {
                  contains: q,
                  mode: "insensitive" as const,
                },
              },
              { companyEmail: { contains: q, mode: "insensitive" as const } },
              {
                memberships: {
                  some: {
                    user: {
                      email: { contains: q, mode: "insensitive" as const },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.database.client.workspace.count({ where }),
      this.database.client.workspace.findMany({
        where,
        orderBy: [{ accessStatus: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          legalName: true,
          registrationNumber: true,
          registrationCountry: true,
          companyEmail: true,
          accessStatus: true,
          createdAt: true,
          memberships: {
            where: { role: "OWNER" },
            take: 1,
            select: { user: { select: { name: true, email: true } } },
          },
          subscriptions: {
            where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
              trialEndsAt: true,
              currentPeriodEnd: true,
              plan: { select: { key: true, name: true } },
            },
          },
        },
      }),
    ]);
    return { companies: rows, page, pageSize: PAGE_SIZE, total };
  }

  public async company(id: string): Promise<unknown> {
    const company = await this.database.client.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        accessStatus: true,
        legalName: true,
        registrationNumber: true,
        registrationCountry: true,
        legalAddress: true,
        companyPhone: true,
        companyEmail: true,
        websiteUrl: true,
        onboardingCompletedAt: true,
        createdAt: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
                emailVerifiedAt: true,
              },
            },
          },
        },
        invitations: {
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            createdAt: true,
          },
        },
        connections: {
          orderBy: { provider: "asc" },
          select: {
            id: true,
            provider: true,
            displayName: true,
            status: true,
            lastSuccessAt: true,
            lastErrorAt: true,
            lastErrorCode: true,
            _count: { select: { accounts: true } },
          },
        },
        providerAccounts: { where: { enabled: true }, select: { id: true } },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            status: true,
            startsAt: true,
            currentPeriodEnd: true,
            trialEndsAt: true,
            plan: { select: { key: true, name: true } },
          },
        },
        entitlements: {
          orderBy: { featureKey: "asc" },
          select: {
            featureKey: true,
            value: true,
            source: true,
            expiresAt: true,
          },
        },
        auditEvents: {
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            eventType: true,
            success: true,
            targetType: true,
            createdAt: true,
            metadata: true,
          },
        },
      },
    });
    if (!company) throw new NotFoundException("Company not found.");
    return {
      ...company,
      selectedAccountCount: company.providerAccounts.length,
      providerAccounts: undefined,
    };
  }

  public async updateCompanyAccess(
    id: string,
    input: AdminAccessStatusDto,
    request: RequestWithAuth,
  ): Promise<unknown> {
    const previous = await this.database.client.workspace.findUnique({
      where: { id },
      select: { accessStatus: true },
    });
    if (!previous) throw new NotFoundException("Company not found.");
    const company = await this.database.client.workspace.update({
      where: { id },
      data: { accessStatus: input.status },
      select: { id: true, name: true, accessStatus: true },
    });
    await this.record(
      "admin_company_access_changed",
      request,
      true,
      {
        from: previous.accessStatus,
        to: input.status,
      },
      id,
      "company",
    );
    return { company };
  }

  public async users(query: { q?: string; page?: number }): Promise<unknown> {
    const page = query.page ?? 1;
    const q = query.q?.trim();
    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [total, users] = await Promise.all([
      this.database.client.user.count({ where }),
      this.database.client.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          createdAt: true,
          sessions: {
            orderBy: { lastSeenAt: "desc" },
            take: 1,
            select: { lastSeenAt: true },
          },
          memberships: {
            select: {
              role: true,
              workspace: {
                select: { id: true, name: true, accessStatus: true },
              },
            },
          },
        },
      }),
    ]);
    return { users, page, pageSize: PAGE_SIZE, total };
  }

  public async updateUserAccess(
    id: string,
    input: AdminUserStatusDto,
    request: RequestWithAuth,
  ) {
    const user = await this.database.client.user
      .update({
        where: { id },
        data: { status: input.status },
        select: { id: true, email: true, name: true, status: true },
      })
      .catch(() => null);
    if (!user) throw new NotFoundException("User not found.");
    if (input.status === "disabled") {
      await this.database.client.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.record(
      "admin_user_access_changed",
      request,
      true,
      { status: input.status },
      undefined,
      "user",
      id,
    );
    return { user };
  }

  public async plans() {
    return {
      plans: await this.database.client.plan.findMany({
        where: {
          active: true,
          key: {
            in: TARIFF_PLANS.flatMap((item) => Object.values(item.dbKey)),
          },
        },
        orderBy: { key: "asc" },
        select: { key: true, name: true, description: true, features: true },
      }),
    };
  }

  public async setPlan(
    id: string,
    input: AdminPlanDto,
    request: RequestWithAuth,
  ) {
    if (!tariffPlanByKey(input.planKey))
      throw new BadRequestException("Plan is not available.");
    const plan = await this.database.client.plan.findUnique({
      where: { key: input.planKey },
      select: {
        id: true,
        key: true,
        name: true,
        active: true,
        prices: {
          where: { active: true, currency: "KZT", interval: "month" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!plan?.active) throw new BadRequestException("Plan is not available.");
    const company = await this.database.client.workspace.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Company not found.");
    const now = new Date();
    const mode = input.mode ?? "TRIAL";
    const trialEndsAt =
      mode === "TRIAL"
        ? new Date(now.getTime() + TARIFF_TRIAL_DAYS * 86_400_000)
        : null;
    await this.database.client.$transaction(async (transaction) => {
      await transaction.workspaceSubscription.updateMany({
        where: {
          workspaceId: id,
          status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
        },
        data: { status: "CANCELED", canceledAt: now },
      });
      await transaction.workspaceSubscription.create({
        data: {
          workspaceId: id,
          planId: plan.id,
          ...(plan.prices[0] ? { priceId: plan.prices[0].id } : {}),
          status: mode === "TRIAL" ? "TRIALING" : "ACTIVE",
          startsAt: now,
          currentPeriodStart: now,
          currentPeriodEnd:
            trialEndsAt ?? new Date(now.getTime() + 365 * 86_400_000),
          ...(trialEndsAt ? { trialEndsAt } : {}),
          metadata: { source: "admin_manual", assignmentMode: mode },
        },
      });
    });
    await this.record(
      "admin_plan_assigned",
      request,
      true,
      {
        plan: plan.key,
        mode,
        ...(mode === "TRIAL" ? { trialDays: TARIFF_TRIAL_DAYS } : {}),
      },
      id,
      "plan",
      plan.id,
    );
    return { plan: { key: plan.key, name: plan.name }, mode, trialEndsAt };
  }

  public async extendTrial(
    id: string,
    input: AdminTrialExtensionDto,
    request: RequestWithAuth,
  ) {
    if (input.days > 90)
      throw new BadRequestException("Trial extension is too long.");
    const subscription =
      await this.database.client.workspaceSubscription.findFirst({
        where: { workspaceId: id, status: "TRIALING" },
        orderBy: { createdAt: "desc" },
        select: { id: true, trialEndsAt: true },
      });
    if (!subscription?.trialEndsAt)
      throw new NotFoundException("Active trial was not found.");
    const base = Math.max(subscription.trialEndsAt.getTime(), Date.now());
    const trialEndsAt = new Date(base + input.days * 86_400_000);
    await this.database.client.workspaceSubscription.update({
      where: { id: subscription.id },
      data: { trialEndsAt, currentPeriodEnd: trialEndsAt },
    });
    await this.record(
      "admin_trial_extended",
      request,
      true,
      { days: input.days, trialEndsAt: trialEndsAt.toISOString() },
      id,
      "subscription",
      subscription.id,
    );
    return { trialEndsAt };
  }

  public async setEntitlement(
    id: string,
    input: AdminEntitlementDto,
    request: RequestWithAuth,
  ) {
    if (!/^[a-z][a-z0-9_.-]{1,119}$/.test(input.featureKey)) {
      throw new BadRequestException("Invalid entitlement key.");
    }
    if (!isEntitlementValue(input.value))
      throw new BadRequestException("Invalid entitlement value.");
    const company = await this.database.client.workspace.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Company not found.");
    const entitlement = await this.database.client.entitlement.upsert({
      where: {
        workspaceId_featureKey: {
          workspaceId: id,
          featureKey: input.featureKey,
        },
      },
      create: {
        workspaceId: id,
        featureKey: input.featureKey,
        value: input.value,
        source: "admin_manual",
      },
      update: { value: input.value, source: "admin_manual", expiresAt: null },
      select: { featureKey: true, value: true, source: true, expiresAt: true },
    });
    await this.record(
      "admin_entitlement_changed",
      request,
      true,
      { featureKey: input.featureKey },
      id,
      "entitlement",
      input.featureKey,
    );
    return { entitlement };
  }

  public async invitation(
    id: string,
    input: AdminInvitationActionDto,
    request: RequestWithAuth,
  ) {
    const invitation =
      await this.database.client.workspaceInvitation.findUnique({
        where: { id },
        select: {
          id: true,
          workspaceId: true,
          inviterId: true,
          email: true,
          role: true,
          acceptedAt: true,
          revokedAt: true,
          expiresAt: true,
        },
      });
    if (!invitation || invitation.acceptedAt)
      throw new NotFoundException("Invitation not found.");
    if (input.action === "cancel") {
      await this.database.client.workspaceInvitation.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await this.record(
        "admin_invitation_cancelled",
        request,
        true,
        undefined,
        invitation.workspaceId,
        "invitation",
        id,
      );
      return { success: true };
    }
    if (invitation.revokedAt || invitation.expiresAt <= new Date()) {
      throw new ForbiddenException("Invitation cannot be resent.");
    }
    await this.database.client.workspaceInvitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    const token = createOpaqueToken();
    const replacement = await this.database.client.workspaceInvitation.create({
      data: {
        workspaceId: invitation.workspaceId,
        inviterId: invitation.inviterId,
        email: invitation.email,
        role: invitation.role,
        tokenDigest: digestToken(token, this.config.sessionHashSecret),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true, email: true, expiresAt: true },
    });
    await this.emails.sendInvitation(replacement.email, token);
    await this.record(
      "admin_invitation_resent",
      request,
      true,
      undefined,
      invitation.workspaceId,
      "invitation",
      replacement.id,
    );
    return { invitation: replacement };
  }

  public async diagnostics(): Promise<unknown> {
    const [connections, tokens, reports] = await Promise.all([
      this.database.client.providerConnection.findMany({
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          provider: true,
          status: true,
          workspace: { select: { id: true, name: true } },
          lastSuccessAt: true,
          lastErrorAt: true,
          lastErrorCode: true,
          _count: { select: { accounts: true } },
        },
      }),
      this.database.client.serviceToken.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          name: true,
          tokenPrefix: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
          lastUsedAt: true,
          serviceIdentity: {
            select: { workspace: { select: { id: true, name: true } } },
          },
        },
      }),
      this.database.client.auditEvent.findMany({
        where: { eventType: { startsWith: "report_" } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          workspaceId: true,
          eventType: true,
          success: true,
          createdAt: true,
        },
      }),
    ]);
    return { connections, tokens, reports };
  }

  public async support(): Promise<unknown> {
    return {
      requests: await this.database.client.manualConnectionRequest.findMany({
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          provider: true,
          companyName: true,
          contactPreference: true,
          clientNote: true,
          status: true,
          specialistNote: true,
          createdAt: true,
          updatedAt: true,
          workspace: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    };
  }

  public async updateSupport(
    id: string,
    input: AdminSupportStatusDto,
    request: RequestWithAuth,
  ): Promise<unknown> {
    const row = await this.database.client.manualConnectionRequest
      .update({
        where: { id },
        data: {
          status: input.status,
          ...(input.note === undefined
            ? {}
            : { specialistNote: input.note.trim() }),
        },
        select: { id: true, workspaceId: true, status: true, updatedAt: true },
      })
      .catch(() => null);
    if (!row) throw new NotFoundException("Support request not found.");
    await this.record(
      "admin_support_request_updated",
      request,
      true,
      { status: input.status },
      row.workspaceId,
      "manual_connection_request",
      id,
    );
    return { request: row };
  }

  public async tariffRequests(): Promise<unknown> {
    return {
      requests: await this.database.client.tariffRequest.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          workspace: {
            select: {
              id: true,
              name: true,
              subscriptions: {
                where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  status: true,
                  plan: { select: { key: true, name: true } },
                },
              },
            },
          },
          user: { select: { id: true, name: true, email: true } },
          requestedPlan: { select: { key: true, name: true } },
        },
      }),
    };
  }

  public async updateTariffRequest(
    id: string,
    input: AdminTariffRequestStatusDto,
    request: RequestWithAuth,
  ): Promise<unknown> {
    const tariffRequest = await this.database.client.tariffRequest.findUnique({
      where: { id },
      select: { id: true, workspaceId: true },
    });
    if (!tariffRequest)
      throw new NotFoundException("Tariff request not found.");
    const updated = await this.database.client.tariffRequest.update({
      where: { id },
      data: {
        status: input.status,
        resolvedAt: ["APPROVED", "DECLINED", "CANCELED"].includes(input.status)
          ? new Date()
          : null,
      },
      include: { requestedPlan: { select: { key: true, name: true } } },
    });
    await this.record(
      "admin_tariff_request_updated",
      request,
      true,
      { status: input.status },
      tariffRequest.workspaceId,
      "tariff_request",
      id,
    );
    return { request: updated };
  }

  public async auditLog(page = 1): Promise<unknown> {
    const [total, events] = await Promise.all([
      this.database.client.auditEvent.count(),
      this.database.client.auditEvent.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          eventType: true,
          success: true,
          actorType: true,
          targetType: true,
          targetId: true,
          createdAt: true,
          workspace: { select: { id: true, name: true } },
          actorUser: { select: { name: true, email: true } },
        },
      }),
    ]);
    return { events, page, pageSize: PAGE_SIZE, total };
  }

  private passwordMatches(input: AdminLoginDto): boolean {
    if (
      !this.config.adminPassword ||
      input.login.trim() !== this.config.adminLogin
    )
      return false;
    const supplied = createHmac("sha256", this.config.sessionHashSecret)
      .update(input.password)
      .digest();
    const expected = createHmac("sha256", this.config.sessionHashSecret)
      .update(this.config.adminPassword)
      .digest();
    return timingSafeEqual(supplied, expected);
  }

  private credentialFingerprint(): string {
    return createHash("sha256")
      .update(
        `${this.config.sessionHashSecret}:${this.config.adminPassword ?? ""}`,
      )
      .digest("hex");
  }

  private header(request: RequestWithAuth, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private async record(
    eventType: string,
    request: RequestWithAuth,
    success = true,
    metadata?: Record<string, string | number | boolean | null>,
    workspaceId?: string,
    targetType?: string,
    targetId?: string,
  ) {
    await this.audit.record({
      eventType,
      success,
      ...(metadata ? { metadata } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
  }
}

function sameValue(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isEntitlementValue(
  value: unknown,
): value is boolean | number | string {
  return (
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 500)
  );
}
