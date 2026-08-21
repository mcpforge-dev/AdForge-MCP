CREATE TYPE "ManualConnectionRequestStatus" AS ENUM (
  'NEW',
  'IN_PROGRESS',
  'WAITING_FOR_CLIENT',
  'READY_FOR_CONNECTION',
  'COMPLETED',
  'CANCELED'
);

CREATE TABLE "manual_connection_requests" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" "ProviderId" NOT NULL DEFAULT 'META_ADS',
  "company_name" VARCHAR(160) NOT NULL,
  "meta_business_id" VARCHAR(64),
  "meta_ad_account_id" VARCHAR(64) NOT NULL,
  "meta_page_id" VARCHAR(64),
  "instagram_username" VARCHAR(80),
  "contact_preference" VARCHAR(24) NOT NULL DEFAULT 'email',
  "client_note" VARCHAR(2000) NOT NULL DEFAULT '',
  "status" "ManualConnectionRequestStatus" NOT NULL DEFAULT 'NEW',
  "specialist_note" VARCHAR(2000) NOT NULL DEFAULT '',
  "assigned_to" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manual_connection_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manual_connection_requests_workspace_id_status_created_at_idx"
  ON "manual_connection_requests"("workspace_id", "status", "created_at");
CREATE INDEX "manual_connection_requests_user_id_provider_status_idx"
  ON "manual_connection_requests"("user_id", "provider", "status");

ALTER TABLE "manual_connection_requests"
  ADD CONSTRAINT "manual_connection_requests_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_connection_requests"
  ADD CONSTRAINT "manual_connection_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
