CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE "BillingOrderStatus" AS ENUM ('OPEN', 'PAID', 'FAILED', 'CANCELED');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "plans" (
  "id" UUID NOT NULL, "key" VARCHAR(80) NOT NULL, "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500), "active" BOOLEAN NOT NULL DEFAULT true, "features" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");
CREATE INDEX "plans_active_idx" ON "plans"("active");

CREATE TABLE "prices" (
  "id" UUID NOT NULL, "plan_id" UUID NOT NULL, "currency" VARCHAR(3) NOT NULL,
  "amount" DECIMAL(18,6) NOT NULL, "interval" VARCHAR(32) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "provider" VARCHAR(80), "provider_price_ref" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prices_plan_id_currency_interval_key" ON "prices"("plan_id", "currency", "interval");
CREATE INDEX "prices_active_currency_idx" ON "prices"("active", "currency");
ALTER TABLE "prices" ADD CONSTRAINT "prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "workspace_subscriptions" (
  "id" UUID NOT NULL, "workspace_id" UUID NOT NULL, "plan_id" UUID NOT NULL, "price_id" UUID,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING', "starts_at" TIMESTAMP(3) NOT NULL,
  "current_period_start" TIMESTAMP(3) NOT NULL, "current_period_end" TIMESTAMP(3) NOT NULL,
  "trial_ends_at" TIMESTAMP(3), "canceled_at" TIMESTAMP(3), "provider_customer_ref" VARCHAR(255),
  "provider_subscription_ref" VARCHAR(255), "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workspace_subscriptions_workspace_id_status_idx" ON "workspace_subscriptions"("workspace_id", "status");
CREATE INDEX "workspace_subscriptions_current_period_end_idx" ON "workspace_subscriptions"("current_period_end");
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "billing_orders" (
  "id" UUID NOT NULL, "workspace_id" UUID NOT NULL, "plan_id" UUID NOT NULL, "price_id" UUID,
  "status" "BillingOrderStatus" NOT NULL DEFAULT 'OPEN', "currency" VARCHAR(3) NOT NULL,
  "amount" DECIMAL(18,6) NOT NULL, "idempotency_key" VARCHAR(160) NOT NULL, "provider_order_ref" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "paid_at" TIMESTAMP(3),
  CONSTRAINT "billing_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_orders_idempotency_key_key" ON "billing_orders"("idempotency_key");
CREATE INDEX "billing_orders_workspace_id_created_at_idx" ON "billing_orders"("workspace_id", "created_at");
CREATE INDEX "billing_orders_status_created_at_idx" ON "billing_orders"("status", "created_at");
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_attempts" (
  "id" UUID NOT NULL, "order_id" UUID NOT NULL, "provider" VARCHAR(80) NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED', "provider_payment_ref" VARCHAR(255),
  "idempotency_key" VARCHAR(160) NOT NULL, "error_code" VARCHAR(120),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_attempts_idempotency_key_key" ON "payment_attempts"("idempotency_key");
CREATE INDEX "payment_attempts_order_id_status_idx" ON "payment_attempts"("order_id", "status");
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "usage_records" (
  "id" UUID NOT NULL, "workspace_id" UUID NOT NULL, "metric_key" VARCHAR(120) NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL, "period_end" TIMESTAMP(3) NOT NULL, "quantity" DECIMAL(24,6) NOT NULL,
  "metadata" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "usage_records_workspace_id_metric_key_period_start_period_end_key" ON "usage_records"("workspace_id", "metric_key", "period_start", "period_end");
CREATE INDEX "usage_records_workspace_id_period_end_idx" ON "usage_records"("workspace_id", "period_end");
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "entitlements" (
  "id" UUID NOT NULL, "workspace_id" UUID NOT NULL, "feature_key" VARCHAR(120) NOT NULL,
  "value" JSONB NOT NULL, "source" VARCHAR(80) NOT NULL, "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "entitlements_workspace_id_feature_key_key" ON "entitlements"("workspace_id", "feature_key");
CREATE INDEX "entitlements_workspace_id_expires_at_idx" ON "entitlements"("workspace_id", "expires_at");
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
