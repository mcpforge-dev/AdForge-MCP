CREATE TABLE "product_events" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID,
  "event_name" VARCHAR(120) NOT NULL,
  "properties" JSONB,
  "request_id" VARCHAR(128),
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_events_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "product_events_event_name_check"
    CHECK ("event_name" ~ '^[a-z][a-z0-9_.-]{1,119}$')
);

CREATE INDEX "product_events_workspace_id_occurred_at_idx"
  ON "product_events"("workspace_id", "occurred_at");
CREATE INDEX "product_events_workspace_id_event_name_occurred_at_idx"
  ON "product_events"("workspace_id", "event_name", "occurred_at");
CREATE INDEX "product_events_user_id_occurred_at_idx"
  ON "product_events"("user_id", "occurred_at");

INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('00000000-0000-0000-0000-000000000013', 'analytics.events.write', 'Record allowlisted workspace product events'),
  ('00000000-0000-0000-0000-000000000014', 'analytics.read', 'Read aggregated workspace product analytics')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('OWNER', '00000000-0000-0000-0000-000000000013'),
  ('OWNER', '00000000-0000-0000-0000-000000000014'),
  ('ADMIN', '00000000-0000-0000-0000-000000000013'),
  ('ADMIN', '00000000-0000-0000-0000-000000000014'),
  ('MEMBER', '00000000-0000-0000-0000-000000000013'),
  ('VIEWER', '00000000-0000-0000-0000-000000000013')
ON CONFLICT DO NOTHING;
