CREATE TABLE "service_tokens" (
    "id" UUID NOT NULL,
    "service_identity_id" UUID NOT NULL,
    "token_digest" VARCHAR(128) NOT NULL,
    "token_prefix" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "scopes" JSONB NOT NULL,
    "account_ids" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "service_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_tokens_token_digest_key" ON "service_tokens"("token_digest");
CREATE INDEX "service_tokens_service_identity_id_revoked_at_idx" ON "service_tokens"("service_identity_id", "revoked_at");
CREATE INDEX "service_tokens_expires_at_idx" ON "service_tokens"("expires_at");

ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_service_identity_id_fkey"
  FOREIGN KEY ("service_identity_id") REFERENCES "service_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('00000000-0000-0000-0000-000000000005', 'mcp.tokens.manage', 'Create, inspect and revoke workspace service tokens');

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('OWNER', '00000000-0000-0000-0000-000000000005'),
  ('ADMIN', '00000000-0000-0000-0000-000000000005');
