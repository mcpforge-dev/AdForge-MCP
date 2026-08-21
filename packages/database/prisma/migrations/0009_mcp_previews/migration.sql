CREATE TABLE "mcp_previews" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "service_token_id" UUID NOT NULL,
    "provider" "ProviderId" NOT NULL,
    "account_id" UUID NOT NULL,
    "external_object_id" VARCHAR(160) NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "diff" JSONB NOT NULL,
    "preview_token_digest" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_previews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_previews_preview_token_digest_key" ON "mcp_previews"("preview_token_digest");
CREATE INDEX "mcp_previews_workspace_id_expires_at_consumed_at_idx" ON "mcp_previews"("workspace_id", "expires_at", "consumed_at");
CREATE INDEX "mcp_previews_service_token_id_created_at_idx" ON "mcp_previews"("service_token_id", "created_at");
CREATE INDEX "mcp_previews_account_id_operation_idx" ON "mcp_previews"("account_id", "operation");

ALTER TABLE "mcp_previews" ADD CONSTRAINT "mcp_previews_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_previews" ADD CONSTRAINT "mcp_previews_service_token_id_fkey" FOREIGN KEY ("service_token_id") REFERENCES "service_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_previews" ADD CONSTRAINT "mcp_previews_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "provider_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
