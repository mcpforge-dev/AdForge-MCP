const TOP_LEVEL_METADATA = [
  ["loginCustomerId", "login_customer_id"],
  ["managerCustomerId", "manager_customer_id"],
  ["googleAdsType", "google_ads_account_type"],
  ["googleAdsLevel", "google_ads_level"],
  ["googleAdsStatus", "google_ads_status"],
  ["businessId", "business_id"],
  ["businessName", "business_name"],
  ["pageId", "page_id"],
  ["pageName", "page_name"],
  ["instagramAccountId", "instagram_account_id"],
  ["instagramUsername", "instagram_username"],
];

export function accountMetadata(account) {
  const existing =
    account?.metadata &&
    typeof account.metadata === "object" &&
    !Array.isArray(account.metadata)
      ? { ...account.metadata }
      : {};

  for (const [target, source] of TOP_LEVEL_METADATA) {
    const value = account?.[source] ?? account?.[target];
    if (typeof value === "string" && value.trim())
      existing[target] = value.trim();
    else if (typeof value === "number" && Number.isFinite(value))
      existing[target] = value;
  }

  for (const key of [
    "requested_permissions",
    "granted_permissions",
    "declined_permissions",
  ]) {
    const value = account?.[key];
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      existing[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] =
        value.slice(0, 100);
    }
  }

  return existing;
}
