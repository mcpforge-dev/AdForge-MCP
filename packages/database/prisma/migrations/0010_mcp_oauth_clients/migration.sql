CREATE TABLE "mcp_oauth_clients" (
    "id" UUID NOT NULL,
    "client_id" VARCHAR(255) NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_name" VARCHAR(160) NOT NULL,
    "redirect_uris" JSONB NOT NULL,
    "scope" VARCHAR(120) NOT NULL DEFAULT 'adforge:mcp:read',
    "token_endpoint_auth_method" VARCHAR(40) NOT NULL DEFAULT 'client_secret_basic',
    "client_secret_digest" VARCHAR(128) NOT NULL,
    "client_secret_prefix" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_authorization_codes" (
    "id" UUID NOT NULL,
    "code_digest" VARCHAR(128) NOT NULL,
    "client_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "redirect_uri" VARCHAR(2000) NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "code_challenge" VARCHAR(200) NOT NULL,
    "code_challenge_method" VARCHAR(16) NOT NULL DEFAULT 'S256',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_key" ON "mcp_oauth_clients"("client_id");
CREATE UNIQUE INDEX "mcp_oauth_clients_client_secret_digest_key" ON "mcp_oauth_clients"("client_secret_digest");
CREATE INDEX "mcp_oauth_clients_workspace_id_status_idx" ON "mcp_oauth_clients"("workspace_id", "status");
CREATE INDEX "mcp_oauth_clients_user_id_status_idx" ON "mcp_oauth_clients"("user_id", "status");
CREATE UNIQUE INDEX "mcp_oauth_authorization_codes_code_digest_key" ON "mcp_oauth_authorization_codes"("code_digest");
CREATE INDEX "mcp_oauth_authorization_codes_client_id_expires_at_used_at_idx" ON "mcp_oauth_authorization_codes"("client_id", "expires_at", "used_at");
CREATE INDEX "mcp_oauth_authorization_codes_workspace_id_user_id_expires_at_idx" ON "mcp_oauth_authorization_codes"("workspace_id", "user_id", "expires_at");

ALTER TABLE "mcp_oauth_clients" ADD CONSTRAINT "mcp_oauth_clients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_clients" ADD CONSTRAINT "mcp_oauth_clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
