INSERT INTO "permissions" ("id", "key", "description") VALUES
  ('00000000-0000-0000-0000-000000000011', 'billing.read', 'Read workspace plan, subscription, usage and entitlements'),
  ('00000000-0000-0000-0000-000000000012', 'billing.manage', 'Manage workspace billing and subscription settings')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_id") VALUES
  ('OWNER', '00000000-0000-0000-0000-000000000011'),
  ('OWNER', '00000000-0000-0000-0000-000000000012'),
  ('ADMIN', '00000000-0000-0000-0000-000000000011')
ON CONFLICT DO NOTHING;
