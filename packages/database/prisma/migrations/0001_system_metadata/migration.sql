CREATE TABLE "system_metadata" (
    "id" UUID NOT NULL,
    "key" VARCHAR(160) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_metadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_metadata_key_key" ON "system_metadata"("key");
CREATE INDEX "system_metadata_updated_at_idx" ON "system_metadata"("updated_at");
