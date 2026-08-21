CREATE TYPE "ProviderId" AS ENUM ('GOOGLE_ADS', 'META_ADS', 'GOOGLE_SEARCH_CONSOLE', 'YANDEX_DIRECT', 'TIKTOK_ADS', 'TEST_PROVIDER');
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'DEGRADED', 'REAUTH_REQUIRED', 'REVOKED', 'DISCONNECTED', 'ERROR');

CREATE TABLE "provider_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" "ProviderId" NOT NULL,
    "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "external_subject_id" VARCHAR(255),
    "display_name" VARCHAR(255),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "connected_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error_code" VARCHAR(120),
    "credential_version" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_credentials" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "encryption_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_accounts" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" "ProviderId" NOT NULL,
    "external_account_id" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "currency" VARCHAR(16),
    "timezone" VARCHAR(80),
    "status" VARCHAR(80),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL,
    "state_digest" VARCHAR(128) NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" "ProviderId" NOT NULL,
    "session_id" UUID NOT NULL,
    "code_verifier_ciphertext" TEXT,
    "code_verifier_encryption_version" INTEGER,
    "code_challenge" VARCHAR(128),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connection_id" UUID,
    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_connections_workspace_id_provider_key" ON "provider_connections"("workspace_id", "provider");
CREATE UNIQUE INDEX "provider_connections_id_workspace_id_provider_key" ON "provider_connections"("id", "workspace_id", "provider");
CREATE INDEX "provider_connections_workspace_id_status_idx" ON "provider_connections"("workspace_id", "status");
CREATE INDEX "provider_connections_created_by_idx" ON "provider_connections"("created_by");
CREATE UNIQUE INDEX "provider_credentials_connection_id_key" ON "provider_credentials"("connection_id");
CREATE INDEX "provider_credentials_encryption_version_idx" ON "provider_credentials"("encryption_version");
CREATE UNIQUE INDEX "provider_accounts_workspace_id_provider_external_account_id_key" ON "provider_accounts"("workspace_id", "provider", "external_account_id");
CREATE INDEX "provider_accounts_connection_id_enabled_idx" ON "provider_accounts"("connection_id", "enabled");
CREATE INDEX "provider_accounts_workspace_id_provider_status_idx" ON "provider_accounts"("workspace_id", "provider", "status");
CREATE UNIQUE INDEX "oauth_states_state_digest_key" ON "oauth_states"("state_digest");
CREATE INDEX "oauth_states_workspace_id_provider_expires_at_idx" ON "oauth_states"("workspace_id", "provider", "expires_at");
CREATE INDEX "oauth_states_user_id_session_id_expires_at_idx" ON "oauth_states"("user_id", "session_id", "expires_at");

ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_connection_id_workspace_id_provider_fkey" FOREIGN KEY ("connection_id", "workspace_id", "provider") REFERENCES "provider_connections"("id", "workspace_id", "provider") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('00000000-0000-0000-0000-000000000005', 'connections.read', 'Read provider connections'),
  ('00000000-0000-0000-0000-000000000006', 'connections.manage', 'Manage provider connections'),
  ('00000000-0000-0000-0000-000000000007', 'provider_accounts.read', 'Read discovered provider accounts'),
  ('00000000-0000-0000-0000-000000000008', 'provider_accounts.manage', 'Enable and manage provider accounts')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('OWNER', '00000000-0000-0000-0000-000000000005'),
  ('OWNER', '00000000-0000-0000-0000-000000000006'),
  ('OWNER', '00000000-0000-0000-0000-000000000007'),
  ('OWNER', '00000000-0000-0000-0000-000000000008'),
  ('ADMIN', '00000000-0000-0000-0000-000000000005'),
  ('ADMIN', '00000000-0000-0000-0000-000000000006'),
  ('ADMIN', '00000000-0000-0000-0000-000000000007'),
  ('ADMIN', '00000000-0000-0000-0000-000000000008'),
  ('MEMBER', '00000000-0000-0000-0000-000000000005'),
  ('MEMBER', '00000000-0000-0000-0000-000000000007'),
  ('VIEWER', '00000000-0000-0000-0000-000000000005'),
  ('VIEWER', '00000000-0000-0000-0000-000000000007')
ON CONFLICT DO NOTHING;
