CREATE TYPE "SiteAuditStatus" AS ENUM (
  'QUEUED', 'CRAWLING', 'BROWSER_ANALYSIS', 'SEO_ANALYSIS', 'PERFORMANCE',
  'AI_ANALYSIS', 'REPORTING', 'COMPLETED', 'FAILED'
);
CREATE TYPE "SiteAuditSeverity" AS ENUM ('P0', 'P1', 'P2', 'P3');
CREATE TYPE "SiteAuditEvidenceKind" AS ENUM ('MEASURED', 'COMPUTED', 'AI_ASSESSMENT');
CREATE TYPE "SiteAuditArtifactKind" AS ENUM (
  'DESKTOP_SCREENSHOT', 'MOBILE_SCREENSHOT', 'ANNOTATED_SCREENSHOT', 'DOCX_REPORT'
);

CREATE TABLE "site_audits" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "normalized_url" VARCHAR(2048) NOT NULL,
  "status" "SiteAuditStatus" NOT NULL DEFAULT 'QUEUED',
  "stage" VARCHAR(80) NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "pages_found" INTEGER NOT NULL DEFAULT 0,
  "pages_checked" INTEGER NOT NULL DEFAULT 0,
  "coverage_sampled" BOOLEAN NOT NULL DEFAULT false,
  "elapsed_ms" INTEGER,
  "scores" JSONB,
  "summary" JSONB,
  "error_code" VARCHAR(80),
  "error_message" VARCHAR(1000),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "site_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_audit_briefs" (
  "id" UUID NOT NULL,
  "audit_id" UUID NOT NULL,
  "company_name" VARCHAR(160),
  "industry" VARCHAR(160),
  "target_audience" VARCHAR(2000),
  "primary_goal" VARCHAR(120),
  "main_problem" VARCHAR(2000),
  "primary_action" VARCHAR(500),
  "market" VARCHAR(500),
  "competitors" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_audit_briefs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_audit_pages" (
  "id" UUID NOT NULL,
  "audit_id" UUID NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "canonical_url" VARCHAR(2048),
  "status_code" INTEGER,
  "indexable" BOOLEAN,
  "discovered_from" VARCHAR(2048),
  "title" VARCHAR(1000),
  "description" VARCHAR(2000),
  "headings" JSONB NOT NULL DEFAULT '{}',
  "checks" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_audit_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_audit_findings" (
  "id" UUID NOT NULL,
  "audit_id" UUID NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "severity" "SiteAuditSeverity" NOT NULL,
  "evidence_kind" "SiteAuditEvidenceKind" NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "finding" VARCHAR(4000) NOT NULL,
  "location" VARCHAR(2048),
  "selector" VARCHAR(1000),
  "evidence" VARCHAR(4000) NOT NULL,
  "impact" VARCHAR(4000) NOT NULL,
  "recommendation" VARCHAR(4000) NOT NULL,
  "owner_role" VARCHAR(80),
  "effort" VARCHAR(120),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_audit_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_audit_metrics" (
  "id" UUID NOT NULL,
  "audit_id" UUID NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "metric_key" VARCHAR(120) NOT NULL,
  "label" VARCHAR(300) NOT NULL,
  "value" JSONB NOT NULL,
  "unit" VARCHAR(40),
  "evidence_kind" "SiteAuditEvidenceKind" NOT NULL,
  "source" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_audit_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_audit_screenshots" (
  "id" UUID NOT NULL,
  "audit_id" UUID NOT NULL,
  "kind" "SiteAuditArtifactKind" NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "data" BYTEA NOT NULL,
  "dom_map" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_audit_screenshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "site_audit_reports" (
  "id" UUID NOT NULL,
  "audit_id" UUID NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "data" BYTEA NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_audit_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "site_audit_briefs_audit_id_key" ON "site_audit_briefs"("audit_id");
CREATE UNIQUE INDEX "site_audit_pages_audit_id_url_key" ON "site_audit_pages"("audit_id", "url");
CREATE UNIQUE INDEX "site_audit_metrics_audit_id_metric_key_key" ON "site_audit_metrics"("audit_id", "metric_key");
CREATE UNIQUE INDEX "site_audit_screenshots_audit_id_kind_key" ON "site_audit_screenshots"("audit_id", "kind");
CREATE UNIQUE INDEX "site_audit_reports_audit_id_key" ON "site_audit_reports"("audit_id");
CREATE INDEX "site_audits_workspace_id_created_at_idx" ON "site_audits"("workspace_id", "created_at");
CREATE INDEX "site_audits_workspace_id_status_created_at_idx" ON "site_audits"("workspace_id", "status", "created_at");
CREATE INDEX "site_audits_user_id_created_at_idx" ON "site_audits"("user_id", "created_at");
CREATE INDEX "site_audit_pages_audit_id_status_code_idx" ON "site_audit_pages"("audit_id", "status_code");
CREATE INDEX "site_audit_findings_audit_id_severity_sort_order_idx" ON "site_audit_findings"("audit_id", "severity", "sort_order");
CREATE INDEX "site_audit_findings_audit_id_category_idx" ON "site_audit_findings"("audit_id", "category");
CREATE INDEX "site_audit_metrics_audit_id_category_idx" ON "site_audit_metrics"("audit_id", "category");

ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_audit_briefs" ADD CONSTRAINT "site_audit_briefs_audit_id_fkey"
  FOREIGN KEY ("audit_id") REFERENCES "site_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_audit_pages" ADD CONSTRAINT "site_audit_pages_audit_id_fkey"
  FOREIGN KEY ("audit_id") REFERENCES "site_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_audit_findings" ADD CONSTRAINT "site_audit_findings_audit_id_fkey"
  FOREIGN KEY ("audit_id") REFERENCES "site_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_audit_metrics" ADD CONSTRAINT "site_audit_metrics_audit_id_fkey"
  FOREIGN KEY ("audit_id") REFERENCES "site_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_audit_screenshots" ADD CONSTRAINT "site_audit_screenshots_audit_id_fkey"
  FOREIGN KEY ("audit_id") REFERENCES "site_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_audit_reports" ADD CONSTRAINT "site_audit_reports_audit_id_fkey"
  FOREIGN KEY ("audit_id") REFERENCES "site_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
