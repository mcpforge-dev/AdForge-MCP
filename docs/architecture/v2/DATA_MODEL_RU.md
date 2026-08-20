# Data Model Report and v2 target

## Current PostgreSQL model

Observed live tables:

`users`, `workspaces`, `workspace_members`, `user_profiles`, `user_sessions`, `password_reset_tokens`, `platform_connections`, `selected_ad_accounts`, `oauth_states`, `mcp_access_tokens`, `mcp_service_tokens`, `mcp_oauth_clients`, `mcp_oauth_client_credentials`, `mcp_oauth_authorization_codes`, `mcp_oauth_access_tokens`, `audit_events`, `manual_connection_requests`.

Current live counts at audit: users 9, workspaces 9, members 9, platform connections 10, selected accounts 191, audit events 0. Staging has the same auth-oriented schema, 7 users and no provider connections/selected accounts in the checked tables.

## Current risks

- schema creation is embedded in application startup, not versioned migrations;
- most relations are logical rather than enforced by foreign keys;
- provider secrets are outside PostgreSQL in JSON;
- account selection and provider connection metadata are split between DB and JSON;
- user lookup historically chooses the oldest workspace, which is not a multi-workspace model;
- no plans, prices, subscriptions, orders, payments, invoices, entitlements, usage or notification tables;
- no durable job/artifact/ webhook-dedup model.

## v2 bounded context model

### Identity

`users`, `user_emails`, `password_credentials`, `sessions`, `password_reset_tokens`, `oauth_identities`, `mfa_factors`.

### Organizations

`organizations`, `workspaces`, `workspace_members`, `roles`, `permissions`, `member_role_bindings`, `workspace_invitations`.

### Providers

`provider_connections`, `provider_credentials` (ciphertext only), `oauth_transactions`, `provider_accounts`, `workspace_provider_accounts`, `account_sync_runs`.

### MCP

`mcp_clients`, `service_tokens`, `service_token_scopes`, `service_token_accounts`, `tool_invocations`, `preview_operations`, `confirmations`.

### Reporting

`reports`, `report_runs`, `report_artifacts`, `report_templates`, `evidence_snapshots`.

### Billing

`plans`, `prices`, `subscriptions`, `subscription_items`, `billing_periods`, `orders`, `payments`, `payment_attempts`, `invoices`, `entitlements`, `usage_counters`, `quota_events`.

### Platform

`jobs`, `job_attempts`, `webhook_events`, `audit_events`, `notifications`, `product_events`, `admin_actions`.

## Invariants

- every provider account, connection, report, token and artifact has immutable `workspace_id`;
- object access is checked in service layer and repository query, not frontend;
- composite uniqueness for `(workspace_id, provider, external_account_id)`;
- credentials cannot be selected/returned through generic ORM serialization;
- preview is linked to workspace/user/token/provider/account/action, has expiry and consumed timestamp;
- webhook idempotency key is unique per provider/event namespace;
- billing writes are idempotent by provider event/order key.

## Migration approach

Create new schema with additive migrations. Import metadata first, then encrypted credentials via a one-time controlled process. Reconcile counts and FK integrity. Keep v1 tables/read path until dual-read and rollback window are complete. Never copy plaintext credential files into Git, reports or migration output.

