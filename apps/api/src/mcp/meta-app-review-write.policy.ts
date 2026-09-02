import type { AppConfig } from "@holymedia/config";
import type { MetaControlledCampaignState } from "../providers/provider.types.js";

export type MetaAppReviewPolicyResult =
  | { kind: "not_configured" }
  | { kind: "blocked"; reason: string; message: string }
  | { kind: "allowed"; requestedName: string };

/** Narrow server-side policy for one Meta App Review demonstration. */
export function evaluateMetaAppReviewRenamePolicy(
  config: AppConfig,
  preview: {
    provider: string;
    operation: string;
    externalObjectId: string;
    payload: unknown;
  },
  account: { externalAccountId: string },
): MetaAppReviewPolicyResult {
  if (!config.metaAppReviewRenameEnabled) return { kind: "not_configured" };
  const requestedName = onlyRequestedName(preview.payload);
  if (preview.provider !== "META_ADS")
    return blocked(
      "provider_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (account.externalAccountId !== config.metaAppReviewRenameAccountId)
    return blocked(
      "account_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (preview.externalObjectId !== config.metaAppReviewRenameCampaignId)
    return blocked(
      "campaign_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (preview.operation !== "change_name")
    return blocked(
      "operation_not_allowed",
      "Разрешено изменить только название подготовленной кампании.",
    );
  if (!requestedName)
    return blocked(
      "payload_not_name_only",
      "Разрешено изменить только название подготовленной кампании.",
    );
  if (requestedName !== config.metaAppReviewRenameTargetName)
    return blocked(
      "target_name_not_allowed",
      "Изменение этой кампании не разрешено текущей политикой.",
    );
  if (
    !config.metaAppReviewRenameExpectedName ||
    !config.metaAppReviewRenameTargetName ||
    !config.metaAppReviewRenameAccountId ||
    !config.metaAppReviewRenameCampaignId
  )
    return blocked(
      "policy_incomplete",
      "Контролируемое переименование не настроено.",
    );
  return { kind: "allowed", requestedName };
}

export function evaluateMetaAppReviewPrecondition(
  config: AppConfig,
  state: MetaControlledCampaignState,
): MetaAppReviewPolicyResult {
  if (state.status !== "PAUSED")
    return blocked(
      "campaign_not_paused",
      "Переименование разрешено только для подготовленной кампании в статусе PAUSED.",
    );
  if (state.name === config.metaAppReviewRenameTargetName)
    return { kind: "allowed", requestedName: state.name };
  if (state.name !== config.metaAppReviewRenameExpectedName)
    return blocked(
      "current_name_not_expected",
      "Название кампании не соответствует подготовленному состоянию для переименования.",
    );
  return {
    kind: "allowed",
    requestedName: config.metaAppReviewRenameTargetName,
  };
}

export function invariantChanges(
  before: MetaControlledCampaignState,
  after: MetaControlledCampaignState,
): string[] {
  const fields: Array<keyof MetaControlledCampaignState> = [
    "status",
    "effectiveStatus",
    "objective",
    "dailyBudget",
    "lifetimeBudget",
    "buyingType",
    "startTime",
    "stopTime",
  ];
  return fields.filter((field) => before[field] !== after[field]);
}

function onlyRequestedName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== "new_name") return null;
  const value = entries[0]?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function blocked(reason: string, message: string): MetaAppReviewPolicyResult {
  return { kind: "blocked", reason, message };
}
