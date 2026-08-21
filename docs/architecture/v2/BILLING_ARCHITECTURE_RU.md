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
