ALTER TABLE "users" ADD COLUMN "status" VARCHAR(32) NOT NULL DEFAULT 'active';

CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");
