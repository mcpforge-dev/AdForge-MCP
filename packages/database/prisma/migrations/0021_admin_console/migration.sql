CREATE TABLE "admin_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_digest" VARCHAR(128) NOT NULL,
  "credential_fingerprint" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "user_agent" VARCHAR(512),
  "ip_hash" VARCHAR(128),
  CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_sessions_token_digest_key" ON "admin_sessions"("token_digest");
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");
