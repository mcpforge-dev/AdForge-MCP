ALTER TABLE "oauth_access_tokens"
  ADD COLUMN "refresh_family_id" UUID;

CREATE INDEX "oauth_access_tokens_refresh_family_id_revoked_at_idx"
  ON "oauth_access_tokens"("refresh_family_id", "revoked_at");

CREATE TABLE "oauth_refresh_tokens" (
  "id" UUID NOT NULL,
  "token_digest" VARCHAR(128) NOT NULL,
  "token_prefix" VARCHAR(32) NOT NULL,
  "family_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "scope" VARCHAR(120) NOT NULL,
  "resource" VARCHAR(2000) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_refresh_tokens_token_digest_key"
  ON "oauth_refresh_tokens"("token_digest");
CREATE INDEX "oauth_refresh_tokens_family_id_revoked_at_expires_at_idx"
  ON "oauth_refresh_tokens"("family_id", "revoked_at", "expires_at");
CREATE INDEX "oauth_refresh_tokens_client_id_user_id_workspace_id_idx"
  ON "oauth_refresh_tokens"("client_id", "user_id", "workspace_id");

ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "oauth_public_clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
