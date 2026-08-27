-- Existing production workspaces retain their current product access. New
-- workspaces use the Prisma PENDING default after this migration completes.
DO $$
BEGIN
  CREATE TYPE "WorkspaceAccessStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "workspaces"
  ADD COLUMN "access_status" "WorkspaceAccessStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "legal_name" VARCHAR(255),
  ADD COLUMN "registration_number" VARCHAR(64),
  ADD COLUMN "registration_country" VARCHAR(2) NOT NULL DEFAULT 'KZ',
  ADD COLUMN "legal_address" VARCHAR(500),
  ADD COLUMN "company_phone" VARCHAR(64),
  ADD COLUMN "company_email" VARCHAR(320),
  ADD COLUMN "website_url" VARCHAR(500),
  ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);

ALTER TABLE "workspaces"
  ALTER COLUMN "access_status" SET DEFAULT 'PENDING';

CREATE INDEX "workspaces_access_status_created_at_idx"
  ON "workspaces"("access_status", "created_at");
