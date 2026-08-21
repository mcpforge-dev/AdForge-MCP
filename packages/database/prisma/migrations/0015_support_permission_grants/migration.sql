INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('00000000-0000-0000-0000-000000000010', 'support.connection_requests.manage', 'Process manual provider connection requests')
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE "user_permission_grants" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "granted_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "user_permission_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permission_grants_user_id_permission_id_key"
  ON "user_permission_grants"("user_id", "permission_id");
CREATE INDEX "user_permission_grants_permission_id_revoked_at_expires_at_idx"
  ON "user_permission_grants"("permission_id", "revoked_at", "expires_at");
CREATE INDEX "user_permission_grants_granted_by_id_idx"
  ON "user_permission_grants"("granted_by_id");

ALTER TABLE "user_permission_grants"
  ADD CONSTRAINT "user_permission_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permission_grants"
  ADD CONSTRAINT "user_permission_grants_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permission_grants"
  ADD CONSTRAINT "user_permission_grants_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
