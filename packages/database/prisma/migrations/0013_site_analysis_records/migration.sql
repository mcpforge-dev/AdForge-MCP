CREATE TABLE "site_analysis_records" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_analysis_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "site_analysis_records_workspace_id_user_id_created_at_idx"
  ON "site_analysis_records"("workspace_id", "user_id", "created_at");
CREATE INDEX "site_analysis_records_workspace_id_created_at_idx"
  ON "site_analysis_records"("workspace_id", "created_at");

ALTER TABLE "site_analysis_records"
  ADD CONSTRAINT "site_analysis_records_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_analysis_records"
  ADD CONSTRAINT "site_analysis_records_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
