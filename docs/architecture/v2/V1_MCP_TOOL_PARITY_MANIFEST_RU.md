# V1 MCP tool parity manifest

Этот manifest получен из AST V1 builders и фиксирует внешний MCP-контракт до
blue/green cutover. Сейчас это inventory, а не заявление о том, что все tools
уже перенесены в V2.

## Source of truth

- V1 registration: `src/ad_mcp/server.py`;
- V1 builders: `src/ad_mcp/tools/*.py`;
- V2 transport: `apps/api/src/mcp/mcp.controller.ts`;
- V2 service-token policy: `apps/api/src/mcp/mcp.service.ts`.

## Audited inventory

```text
analyze_audiences, archive_entities_preview, audit_account, audit_links_and_utms,
clone_ad_preview, clone_adset_preview, clone_campaign_preview, collect_report_skill,
commit_meta_app_review_preview, commit_meta_confirmed_write, commit_preview,
compare_creatives, compare_periods, configure_schedule_from_brief, create_ab_test_ads_preview,
create_ad_from_brief, create_ad_group_from_brief, create_ad_in_existing_adset_preview,
create_adset_in_campaign_preview, create_audience_from_brief, create_audience_variant_preview,
create_campaign_from_brief, create_creative_preview, create_engagement_campaign_preview,
create_keyword_from_brief, create_lead_campaign_preview, create_whatsapp_traffic_campaign_preview,
describe_auth, describe_auth_strategy, detect_anomalies, disable_candidates_skill,
duplicate_campaign_with_audience_preview, duplicate_campaign_with_geo_preview,
enable_entities_preview, estimate_budget_days_remaining, find_burnout_ads, find_wasting_spend,
generate_monthly_ads_report, get_account_object, get_account_status, get_account_summary,
get_asset_health, get_basic_metrics, get_beta_diagnostics, get_billing_summary,
get_breakdown_preset, get_campaign, get_campaign_statuses, get_campaign_structure,
get_connected_assets, get_conversion_health, get_delivery_issues, get_executive_summary,
get_flexible_insights, get_google_ads_detailed_report, get_launch_checklist,
get_meta_ads_detailed_report, get_meta_business, get_meta_oauth_permissions, get_meta_page,
get_minimum_budgets_read, get_no_result_entities, get_object, get_page_instagram_account,
get_page_post, get_page_post_engagement, get_performance_report, get_policy_issues,
get_provider_capabilities, get_reach_estimate_read, get_recommendations_read,
get_rule_history, get_spend_overview, get_status_summary, get_top_performers,
get_tracking_specs, list_account_objects, list_accounts, list_ad_accounts,
list_automated_rules, list_business_ad_accounts, list_business_pages, list_campaigns,
list_connected_platforms, list_creative_assets, list_detailed_ad_report_types,
list_lead_forms, list_meta_businesses, list_meta_pages, list_objects, list_operator_skills,
list_page_posts, list_providers, list_supported_audience_types, list_supported_campaign_types,
list_supported_dimensions, list_supported_metrics, list_supported_objects, pause_entities_preview,
pause_underperformers_preview, preview_change_adset_or_group_budget,
preview_change_campaign_budget, preview_change_campaign_name, preview_create_object,
preview_delete_or_archive_object, preview_meta_create_ad, preview_meta_create_adset,
preview_meta_create_campaign, preview_meta_create_creative, preview_meta_update_ad,
preview_meta_update_adset, preview_meta_update_campaign, preview_pause_ad,
preview_pause_adset_or_group, preview_pause_campaign, preview_resume_ad,
preview_resume_adset_or_group, preview_resume_campaign, preview_update_object,
rank_top_entities, rebalance_budget_to_end_of_month_preview, replace_ad_creative_preview,
run_connection_diagnostics, run_diagnostics, scale_best_campaigns_preview,
scale_candidates_skill, scale_winners_by_rule_preview, search_targeting,
summarize_budget_skill, update_adset_budget_preview, update_campaign_budget_preview,
update_entity_status_preview, update_placements_preview, update_targeting_preview
```

Audited count: **134 tools**.

## V2 status at current Phase A checkpoint

- **Implemented and server-authorized read surface:** provider discovery,
  accounts, account summary/status, campaigns, campaign status/lookup, metrics,
  performance report, diagnostics, Meta Business/Page/posts/engagement/Instagram,
  capability aliases and scoped service-token enforcement.
- **Implemented policy boundary but not enabled for writes:** preview/confirmation/
  commit tools are intentionally absent from V2 MCP until their provider-neutral
  implementation is migrated and tested. `preview_only` remains authoritative.
- **Not yet migrated:** detailed analytics, billing, SEO/Search Console, site
  analysis, document exports, report skill presets and remaining write tools.

Tool parity is accepted only after input contract, authorization, tenant/account
policy, response semantics and regression tests are present. Inventory presence
alone never exposes a placeholder tool to clients.
