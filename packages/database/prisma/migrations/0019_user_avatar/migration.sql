ALTER TABLE "users"
ADD COLUMN "avatar_data" BYTEA,
ADD COLUMN "avatar_mime_type" VARCHAR(32);
