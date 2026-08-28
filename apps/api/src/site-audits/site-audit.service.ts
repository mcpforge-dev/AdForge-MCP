import { Injectable, NotFoundException } from "@nestjs/common";
import { Queue } from "bullmq";
import { normalizePublicUrl } from "@holymedia/site-audit";
import { loadConfig } from "@holymedia/config";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { ProviderService } from "../providers/provider.service.js";

const SITE_AUDIT_QUEUE = "holymedia-v3-site-audit";

export type CreateSiteAuditInput = {
  url: string;
  companyName?: string;
  industry?: string;
  targetAudience?: string;
  primaryGoal?: string;
  mainProblem?: string;
  primaryAction?: string;
  market?: string;
  competitors?: string[];
};

@Injectable()
export class SiteAuditService {
  public constructor(
    private readonly database: DatabaseService,
    private readonly providers: ProviderService,
  ) {}

  public async create(
    workspaceId: string,
    userId: string,
    input: CreateSiteAuditInput,
  ) {
    const normalizedUrl = await normalizePublicUrl(input.url);
    const audit = await this.database.client.siteAudit.create({
      data: {
        workspaceId,
        userId,
        url: input.url.trim(),
        normalizedUrl,
        brief: {
          create: {
            companyName: optional(input.companyName),
            industry: optional(input.industry),
            targetAudience: optional(input.targetAudience),
            primaryGoal: optional(input.primaryGoal),
            mainProblem: optional(input.mainProblem),
            primaryAction: optional(input.primaryAction),
            market: optional(input.market),
            competitors: (input.competitors ?? []).map((item) => item.trim()),
          },
        },
      },
      include: { brief: true },
    });
    const config = loadConfig();
    const queue = new Queue(SITE_AUDIT_QUEUE, {
      connection: redisConnection(config.redisUrl),
    });
    try {
      await queue.add(
        "site-audit.run",
        {
          auditId: audit.id,
          workspaceId,
          requestedAt: new Date().toISOString(),
        },
        {
          jobId: `site-audit-${audit.id}`,
          attempts: 2,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    } finally {
      await queue.close();
    }
    return serialize(audit);
  }

  public async list(workspaceId: string) {
    const rows = await this.database.client.siteAudit.findMany({
      where: { workspaceId },
      include: { brief: true, findings: { select: { severity: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return { items: rows.map(serialize) };
  }

  public async get(workspaceId: string, auditId: string) {
    const audit = await this.database.client.siteAudit.findFirst({
      where: { id: auditId, workspaceId },
      include: {
        brief: true,
        pages: { orderBy: { url: "asc" } },
        findings: { orderBy: [{ severity: "asc" }, { sortOrder: "asc" }] },
        metrics: { orderBy: { metricKey: "asc" } },
        screenshots: { select: { kind: true, domMap: true } },
        report: { select: { generatedAt: true } },
      },
    });
    if (!audit) throw new NotFoundException("Аудит не найден.");
    const searchConsole =
      audit.status === "COMPLETED"
        ? await this.searchConsoleForWorkspace(workspaceId, audit.normalizedUrl)
        : undefined;
    return { ...serialize(audit), ...(searchConsole ? { searchConsole } : {}) };
  }

  public async report(workspaceId: string, auditId: string) {
    const item = await this.database.client.siteAuditReport.findFirst({
      where: { auditId, audit: { workspaceId } },
      select: { data: true, mimeType: true },
    });
    if (!item) throw new NotFoundException("Word-отчёт ещё не готов.");
    return item;
  }

  public async screenshot(
    workspaceId: string,
    auditId: string,
    kind: "desktop" | "mobile" | "annotated",
  ) {
    const item = await this.database.client.siteAuditScreenshot.findFirst({
      where: { auditId, audit: { workspaceId }, kind: artifactKind(kind) },
      select: { data: true, mimeType: true },
    });
    if (!item) throw new NotFoundException("Скриншот ещё не готов.");
    return item;
  }

  private async searchConsoleForWorkspace(workspaceId: string, url: string) {
    try {
      const report = await this.providers.searchConsoleReport(
        workspaceId,
        new URL(url).origin,
        28,
      );
      if (report.status !== "ok") return undefined;
      return {
        status: "connected",
        metrics: report.metrics,
        topQueries: report.top_queries,
        topPages: report.top_pages,
        source: report.source_api,
      };
    } catch {
      return undefined;
    }
  }
}

function optional(value?: string) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

function artifactKind(kind: "desktop" | "mobile" | "annotated") {
  return {
    desktop: "DESKTOP_SCREENSHOT",
    mobile: "MOBILE_SCREENSHOT",
    annotated: "ANNOTATED_SCREENSHOT",
  }[kind] as
    "DESKTOP_SCREENSHOT" | "MOBILE_SCREENSHOT" | "ANNOTATED_SCREENSHOT";
}

function serialize(row: Record<string, unknown>) {
  const findings = Array.isArray(row.findings)
    ? (row.findings as Array<{ severity?: string }>)
    : [];
  return {
    ...row,
    findings:
      Array.isArray(row.findings) &&
      findings[0] &&
      Object.keys(findings[0]).length === 1
        ? undefined
        : row.findings,
    issueCounts: findings.reduce<Record<string, number>>((counts, item) => {
      const key = item.severity ?? "P3";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export { SITE_AUDIT_QUEUE, redisConnection };
