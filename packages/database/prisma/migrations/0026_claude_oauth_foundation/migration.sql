CREATE TABLE "oauth_public_clients" (
  "id" UUID NOT NULL,
  "client_id" VARCHAR(255) NOT NULL,
  "client_name" VARCHAR(160) NOT NULL,
  "redirect_uris" JSONB NOT NULL,
  "scope" VARCHAR(120) NOT NULL DEFAULT 'adforge:mcp:read',
  "token_endpoint_auth_method" VARCHAR(40) NOT NULL DEFAULT 'none',
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "oauth_public_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_public_clients_client_id_key" ON "oauth_public_clients"("client_id");

CREATE TABLE "oauth_authorization_transactions" (
  "id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "redirect_uri" VARCHAR(2000) NOT NULL,
  "state" VARCHAR(1000),
  "scope" VARCHAR(120) NOT NULL,
  "resource" VARCHAR(2000) NOT NULL,
  "code_challenge" VARCHAR(200) NOT NULL,
  "code_challenge_method" VARCHAR(16) NOT NULL DEFAULT 'S256',
  "user_id" UUID,
  "workspace_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  CONSTRAINT "oauth_authorization_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oauth_authorization_transactions_client_id_expires_at_consumed_at_idx" ON "oauth_authorization_transactions"("client_id", "expires_at", "consumed_at");
CREATE INDEX "oauth_authorization_transactions_user_id_workspace_id_expires_at_idx" ON "oauth_authorization_transactions"("user_id", "workspace_id", "expires_at");

CREATE TABLE "oauth_authorization_codes" (
  "id" UUID NOT NULL,
  "code_digest" VARCHAR(128) NOT NULL,
  "client_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "redirect_uri" VARCHAR(2000) NOT NULL,
  "scope" VARCHAR(120) NOT NULL,
  "resource" VARCHAR(2000) NOT NULL,
  "code_challenge" VARCHAR(200) NOT NULL,
  "code_challenge_method" VARCHAR(16) NOT NULL DEFAULT 'S256',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_authorization_codes_code_digest_key" ON "oauth_authorization_codes"("code_digest");
CREATE INDEX "oauth_authorization_codes_client_id_expires_at_used_at_idx" ON "oauth_authorization_codes"("client_id", "expires_at", "used_at");
CREATE INDEX "oauth_authorization_codes_workspace_id_user_id_expires_at_idx" ON "oauth_authorization_codes"("workspace_id", "user_id", "expires_at");

CREATE TABLE "oauth_access_tokens" (
  "id" UUID NOT NULL,
  "token_digest" VARCHAR(128) NOT NULL,
  "token_prefix" VARCHAR(32) NOT NULL,
  "client_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "scope" VARCHAR(120) NOT NULL,
  "resource" VARCHAR(2000) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  CONSTRAINT "oauth_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_access_tokens_token_digest_key" ON "oauth_access_tokens"("token_digest");
CREATE INDEX "oauth_access_tokens_workspace_id_revoked_at_expires_at_idx" ON "oauth_access_tokens"("workspace_id", "revoked_at", "expires_at");
CREATE INDEX "oauth_access_tokens_client_id_user_id_idx" ON "oauth_access_tokens"("client_id", "user_id");

ALTER TABLE "oauth_authorization_transactions" ADD CONSTRAINT "oauth_authorization_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_public_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_transactions" ADD CONSTRAINT "oauth_authorization_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_transactions" ADD CONSTRAINT "oauth_authorization_transactions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_public_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_public_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
