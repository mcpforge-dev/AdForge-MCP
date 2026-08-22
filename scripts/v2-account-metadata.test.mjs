import assert from "node:assert/strict";
import { accountMetadata } from "./v2-account-metadata.mjs";

const metadata = accountMetadata({
  metadata: { source: "v1" },
  login_customer_id: "2237052966",
  manager_customer_id: "2237052966",
  google_ads_account_type: "customer",
  google_ads_level: "1",
  granted_permissions: ["ads_read"],
});

assert.deepEqual(metadata, {
  source: "v1",
  loginCustomerId: "2237052966",
  managerCustomerId: "2237052966",
  googleAdsType: "customer",
  googleAdsLevel: "1",
  grantedPermissions: ["ads_read"],
});

assert.deepEqual(accountMetadata({ login_customer_id: "" }), {});
console.log("v2 account metadata migration tests passed");
