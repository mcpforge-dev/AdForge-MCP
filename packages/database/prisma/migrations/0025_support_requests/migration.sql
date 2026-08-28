CREATE TYPE "SupportRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED');
CREATE TYPE "TelegramDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED');

CREATE TABLE "support_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "message" VARCHAR(4000) NOT NULL,
  "source_route" VARCHAR(256),
  "locale" VARCHAR(8),
  "idempotency_key" VARCHAR(80),
  "status" "SupportRequestStatus" NOT NULL DEFAULT 'NEW',
  "telegram_delivery_status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "telegram_delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  "telegram_message_id" VARCHAR(64),
  "telegram_delivered_at" TIMESTAMP(3),
  "telegram_last_error_code" VARCHAR(120),
  "plan_key" VARCHAR(80),
  "company_access_status" "WorkspaceAccessStatus",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "support_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "support_requests_workspace_id_user_id_idempotency_key_key" ON "support_requests"("workspace_id", "user_id", "idempotency_key");
CREATE INDEX "support_requests_workspace_id_status_created_at_idx" ON "support_requests"("workspace_id", "status", "created_at");
CREATE INDEX "support_requests_telegram_delivery_status_created_at_idx" ON "support_requests"("telegram_delivery_status", "created_at");
