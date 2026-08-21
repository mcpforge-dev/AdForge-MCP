INSERT INTO "plans" (
  "id", "key", "name", "description", "active", "features", "updated_at"
) VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    'free',
    'Free',
    'Starter plan for new HolyMedia workspaces',
    true,
    '{"mcp":true,"reports":true,"provider_accounts":1,"monthly_mcp_requests":500}'::jsonb,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'legacy_internal',
    'Legacy Internal',
    'Internal migration plan preserving V1 product access during cutover',
    false,
    '{"mcp":true,"reports":true,"hermes":true,"provider_accounts":null,"monthly_mcp_requests":null,"legacy_access":true}'::jsonb,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "features" = EXCLUDED."features",
  "updated_at" = CURRENT_TIMESTAMP;
