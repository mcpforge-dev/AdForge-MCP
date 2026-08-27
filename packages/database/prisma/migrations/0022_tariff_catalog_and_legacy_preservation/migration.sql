-- Product tariff catalog derived from AI_Marketing_Tariffs.xlsx.
-- The application catalog owns labels and the complete comparison matrix; these
-- records make the same options assignable and enforceable in V2 billing.
INSERT INTO "plans" ("id", "key", "name", "description", "active", "features", "updated_at") VALUES
  ('00000000-0000-0000-0000-000000000201', 'ai_site_self', 'AI Website', 'AI Website — self-service', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":7500,"tariff_code":"site","service_level":"SELF_SERVICE"}'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000202', 'ai_ads_self', 'AI Ads', 'AI Ads — self-service', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":10000,"tariff_code":"ads","service_level":"SELF_SERVICE"}'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000203', 'ai_seo_self', 'AI SEO', 'AI SEO — self-service', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":10000,"tariff_code":"seo","service_level":"SELF_SERVICE"}'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000204', 'ai_marketing_self', 'AI Marketing', 'AI Marketing — self-service', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":25000,"tariff_code":"marketing","service_level":"SELF_SERVICE"}'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000205', 'ai_site_support', 'AI Website + Holy Media support', 'AI Website with Holy Media support', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":7500,"tariff_code":"site","service_level":"HOLYMEDIA_SUPPORT"}'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000206', 'ai_ads_support', 'AI Ads + Holy Media support', 'AI Ads with Holy Media support', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":10000,"tariff_code":"ads","service_level":"HOLYMEDIA_SUPPORT"}'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000207', 'ai_seo_support', 'AI SEO + Holy Media support', 'AI SEO with Holy Media support', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":10000,"tariff_code":"seo","service_level":"HOLYMEDIA_SUPPORT"}'::jsonb, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000208', 'ai_marketing_support', 'AI Marketing + Holy Media support', 'AI Marketing with Holy Media support', true, '{"mcp":true,"reports":true,"provider_accounts":null,"monthly_mcp_requests":25000,"tariff_code":"marketing","service_level":"HOLYMEDIA_SUPPORT"}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name", "description" = EXCLUDED."description", "active" = EXCLUDED."active", "features" = EXCLUDED."features", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "prices" ("id", "plan_id", "currency", "amount", "interval", "active", "updated_at")
SELECT price_id::uuid, id, 'KZT', amount, 'month', true, CURRENT_TIMESTAMP
FROM (VALUES
  ('00000000-0000-0000-0000-000000000301', 'ai_site_self', 149000::numeric),
  ('00000000-0000-0000-0000-000000000302', 'ai_ads_self', 199000::numeric),
  ('00000000-0000-0000-0000-000000000303', 'ai_seo_self', 199000::numeric),
  ('00000000-0000-0000-0000-000000000304', 'ai_marketing_self', 399000::numeric),
  ('00000000-0000-0000-0000-000000000305', 'ai_site_support', 550000::numeric),
  ('00000000-0000-0000-0000-000000000306', 'ai_ads_support', 550000::numeric),
  ('00000000-0000-0000-0000-000000000307', 'ai_seo_support', 550000::numeric),
  ('00000000-0000-0000-0000-000000000308', 'ai_marketing_support', 790000::numeric)
) AS source(price_id, key, amount)
JOIN "plans" ON "plans"."key" = source.key
ON CONFLICT ("plan_id", "currency", "interval") DO UPDATE SET "amount" = EXCLUDED."amount", "active" = true, "updated_at" = CURRENT_TIMESTAMP;

-- Existing active workspaces remain on their approved legacy access. New
-- companies receive a tariff only through the protected admin assignment flow.
INSERT INTO "workspace_subscriptions" (
  "id", "workspace_id", "plan_id", "status", "starts_at", "current_period_start", "current_period_end", "metadata"
)
SELECT gen_random_uuid(), w."id", p."id", 'ACTIVE', w."created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '365 days',
       '{"source":"tariff_catalog_legacy_preservation"}'::jsonb
FROM "workspaces" w
JOIN "plans" p ON p."key" = 'legacy_internal'
WHERE w."access_status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_subscriptions" s
    WHERE s."workspace_id" = w."id" AND s."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
  );
