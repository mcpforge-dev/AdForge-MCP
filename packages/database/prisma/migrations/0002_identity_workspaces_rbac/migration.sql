CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "AuditActorType" AS ENUM ('HUMAN', 'SERVICE');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_memberships" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
    "role" "WorkspaceRole" NOT NULL,
    "permission_id" UUID NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role", "permission_id")
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_digest" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "user_agent" VARCHAR(512),
    "ip_hash" VARCHAR(128),
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_digest" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_digest" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "token_digest" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_identities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "service_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "actor_user_id" UUID,
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'HUMAN',
    "event_type" VARCHAR(120) NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "target_type" VARCHAR(120),
    "target_id" VARCHAR(160),
    "request_id" VARCHAR(128),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");
CREATE INDEX "workspaces_created_at_idx" ON "workspaces"("created_at");
CREATE UNIQUE INDEX "workspace_memberships_workspace_id_user_id_key" ON "workspace_memberships"("workspace_id", "user_id");
CREATE INDEX "workspace_memberships_user_id_workspace_id_idx" ON "workspace_memberships"("user_id", "workspace_id");
CREATE INDEX "workspace_memberships_workspace_id_role_idx" ON "workspace_memberships"("workspace_id", "role");
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE UNIQUE INDEX "sessions_token_digest_key" ON "sessions"("token_digest");
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE UNIQUE INDEX "email_verifications_token_digest_key" ON "email_verifications"("token_digest");
CREATE INDEX "email_verifications_user_id_used_at_idx" ON "email_verifications"("user_id", "used_at");
CREATE INDEX "email_verifications_expires_at_idx" ON "email_verifications"("expires_at");
CREATE UNIQUE INDEX "password_resets_token_digest_key" ON "password_resets"("token_digest");
CREATE INDEX "password_resets_user_id_used_at_idx" ON "password_resets"("user_id", "used_at");
CREATE INDEX "password_resets_expires_at_idx" ON "password_resets"("expires_at");
CREATE UNIQUE INDEX "workspace_invitations_token_digest_key" ON "workspace_invitations"("token_digest");
CREATE INDEX "workspace_invitations_workspace_id_email_idx" ON "workspace_invitations"("workspace_id", "email");
CREATE INDEX "workspace_invitations_workspace_id_expires_at_idx" ON "workspace_invitations"("workspace_id", "expires_at");
CREATE INDEX "service_identities_workspace_id_revoked_at_idx" ON "service_identities"("workspace_id", "revoked_at");
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events"("workspace_id", "created_at");
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at");

ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_identities" ADD CONSTRAINT "service_identities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('00000000-0000-0000-0000-000000000001', 'workspace.read', 'Read workspace settings'),
  ('00000000-0000-0000-0000-000000000002', 'workspace.manage', 'Manage workspace settings'),
  ('00000000-0000-0000-0000-000000000003', 'members.read', 'Read workspace members'),
  ('00000000-0000-0000-0000-000000000004', 'members.manage', 'Manage workspace members and invitations');

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('OWNER', '00000000-0000-0000-0000-000000000001'), ('OWNER', '00000000-0000-0000-0000-000000000002'), ('OWNER', '00000000-0000-0000-0000-000000000003'), ('OWNER', '00000000-0000-0000-0000-000000000004'),
  ('ADMIN', '00000000-0000-0000-0000-000000000001'), ('ADMIN', '00000000-0000-0000-0000-000000000002'), ('ADMIN', '00000000-0000-0000-0000-000000000003'), ('ADMIN', '00000000-0000-0000-0000-000000000004'),
  ('MEMBER', '00000000-0000-0000-0000-000000000001'), ('MEMBER', '00000000-0000-0000-0000-000000000003'),
  ('VIEWER', '00000000-0000-0000-0000-000000000001'), ('VIEWER', '00000000-0000-0000-0000-000000000003');

CREATE OR REPLACE FUNCTION ensure_workspace_has_owner() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(OLD.workspace_id::text));
  IF OLD.role = 'OWNER' AND (TG_OP = 'DELETE' OR NEW.role <> 'OWNER')
     AND NOT EXISTS (
       SELECT 1 FROM "workspace_memberships"
       WHERE "workspace_id" = OLD.workspace_id
         AND "role" = 'OWNER'
         AND "id" <> OLD.id
     ) THEN
    RAISE EXCEPTION 'workspace must retain an owner';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_memberships_owner_guard
BEFORE UPDATE OF "role" OR DELETE ON "workspace_memberships"
FOR EACH ROW EXECUTE FUNCTION ensure_workspace_has_owner();
