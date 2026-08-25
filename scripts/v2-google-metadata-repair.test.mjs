import assert from "node:assert/strict";
import {
  googleMetadataFromV1,
  stableUuid,
} from "./v2-google-metadata-repair.mjs";

assert.deepEqual(
  googleMetadataFromV1({
    login_customer_id: "1234567890",
    manager_customer_id: "0987654321",
    google_ads_account_type: "customer",
    google_ads_level: "1",
    metadata: { source: "v1" },
  }),
  {
    loginCustomerId: "1234567890",
    managerCustomerId: "0987654321",
    googleAdsType: "customer",
    googleAdsLevel: "1",
  },
);
assert.equal(
  stableUuid("workspace", "legacy-workspace"),
  stableUuid("workspace", "legacy-workspace"),
);
console.log("v2 Google metadata repair helpers passed");
