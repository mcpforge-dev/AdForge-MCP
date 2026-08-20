# Provider Integration Matrix

| Provider | OAuth | Account discovery | Reads | Writes | Current truth | v2 parity gate |
|---|---|---|---|---|---|---|
| Google Ads | implemented; access/refresh/developer token | live | accounts, campaigns, detailed reports and core metrics | preview/guarded abstractions; no broad production write | strongest current integration | real staging smoke, GAQL contract fixtures, quota/retry and account policy |
| Meta Ads | implemented; scopes configurable, `ads_management` opt-in | live | Ads, Business, Page, Page/Instagram relation and Insights where permission allows | preview/confirmed workflow exists; live global preview-only at audit | live reads depend on Meta permissions and object access | Graph contract suite, permission mapping, allowlist write test, reread/audit |
| Yandex Direct | OAuth/config path exists | partial | provider surface exists; report path is preview/placeholder | not production parity | not a real-data parity provider | decide scope, implement or label unavailable |
| TikTok Ads | OAuth/config path exists | partial | provider surface exists; report path is preview/placeholder | not production parity | not a real-data parity provider | decide scope, implement or label unavailable |
| Google Search Console | OAuth path and SEO UI history | properties/reporting partial | current product feature is limited/hidden in recent MVP state | n/a | separate SEO domain required | property isolation, consent/scope, report export tests |

## Common internal contract

Every adapter should implement:

```text
ProviderAdapter
  capabilities()
  authorize(request): AuthorizationUrl
  callback(request): ConnectionResult
  listAccounts(context): Page<Account>
  getAccount(context, accountId): Account
  queryMetrics(context, query): MetricsPage
  preview(operation): Preview
  commit(confirmedOperation): MutationResult
  health(context): ProviderHealth
```

The contract must return typed `ProviderError` categories (`auth_required`, `permission_denied`, `rate_limited`, `not_found`, `invalid_request`, `temporary`, `unsupported`) and provenance (`source_api`, `real_data`, `data_status`, `fetched_at`). Provider-specific fields stay behind adapter DTOs.

## Rules

No browser-to-provider calls. No provider token in analytics/logging. Account IDs are normalized before policy comparison. Reads must paginate and respect provider rate limits. Writes require capability, workspace permission, account allowlist, preview, one-time confirmation and reread.

