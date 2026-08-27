CREATE TYPE "TariffRequestStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'DECLINED', 'CANCELED');

CREATE TABLE "tariff_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "requested_plan_id" UUID NOT NULL,
  "requested_service_level" VARCHAR(32) NOT NULL,
  "status" "TariffRequestStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "tariff_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tariff_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tariff_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tariff_requests_requested_plan_id_fkey" FOREIGN KEY ("requested_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "tariff_requests_workspace_id_status_created_at_idx" ON "tariff_requests"("workspace_id", "status", "created_at");
CREATE INDEX "tariff_requests_status_created_at_idx" ON "tariff_requests"("status", "created_at");
