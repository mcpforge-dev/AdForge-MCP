ALTER TABLE "service_identities"
  ADD COLUMN "created_by_id" UUID;

CREATE INDEX "service_identities_created_by_id_revoked_at_idx"
  ON "service_identities"("created_by_id", "revoked_at");

ALTER TABLE "service_identities"
  ADD CONSTRAINT "service_identities_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
