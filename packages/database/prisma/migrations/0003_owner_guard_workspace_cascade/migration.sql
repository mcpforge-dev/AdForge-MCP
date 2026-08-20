CREATE OR REPLACE FUNCTION ensure_workspace_has_owner() RETURNS trigger AS $$
BEGIN
  -- A workspace delete cascades its memberships after the parent row is gone.
  -- The owner invariant applies to a live workspace, not to that cascade.
  IF NOT EXISTS (
    SELECT 1 FROM "workspaces" WHERE "id" = OLD.workspace_id
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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
