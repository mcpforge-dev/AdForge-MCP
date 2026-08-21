CREATE TABLE "google_login_states" (
    "id" UUID NOT NULL,
    "state_digest" VARCHAR(128) NOT NULL,
    "next_path" VARCHAR(255) NOT NULL DEFAULT '/dashboard',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "google_login_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_login_states_state_digest_key" ON "google_login_states"("state_digest");
CREATE INDEX "google_login_states_expires_at_consumed_at_idx" ON "google_login_states"("expires_at", "consumed_at");
