ALTER TABLE "oauth_public_clients"
  ADD COLUMN "application_type" VARCHAR(16) NOT NULL DEFAULT 'web',
  ADD COLUMN "registration_source" VARCHAR(16) NOT NULL DEFAULT 'dcr',
  ADD COLUMN "metadata_etag" VARCHAR(512),
  ADD COLUMN "metadata_fetched_at" TIMESTAMP(3),
  ADD COLUMN "metadata_expires_at" TIMESTAMP(3);

CREATE INDEX "oauth_public_clients_registration_source_metadata_expires_at_idx"
  ON "oauth_public_clients"("registration_source", "metadata_expires_at");
