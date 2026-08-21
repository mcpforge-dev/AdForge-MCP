# Billing architecture V2

Billing is a domain boundary, not a direct dependency on a payment gateway.
Phase A currently provides the database model and read API for plans, prices,
workspace subscriptions, orders, payment attempts, usage and entitlements.

The payment integration point is `apps/api/src/billing/payment-provider.ts`.
No provider is selected, no real checkout is enabled, and no payment secrets are
required by the V2 runtime. A future adapter must verify webhook signatures,
deduplicate events and update subscription/order state in a transaction.

Existing V1 workspaces can receive a legacy/internal entitlement during Phase B
without changing provider connections or removing current functionality.

## Enforcement

Entitlements and plan features are evaluated only on the API server. The free
plan currently enables MCP and reports, limits enabled provider accounts, and
applies a monthly MCP request quota. MCP usage is reserved in a serializable
PostgreSQL transaction before tool execution, so concurrent requests cannot
bypass the limit. Report generation checks the `reports` feature, and account
selection checks `provider_accounts` before enabling an additional account.

An active workspace entitlement overrides the current plan. The migration-only
`legacy_access=true` entitlement keeps existing V1 workspaces functionally
unlimited during cutover. It is never inferred from frontend state.

The payment gateway remains an adapter boundary. Checkout cannot be enabled
until a concrete provider supplies signed webhook verification and idempotent
order/payment state transitions.
