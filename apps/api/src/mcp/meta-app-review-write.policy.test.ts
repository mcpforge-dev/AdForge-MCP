import { describe, expect, it } from "vitest";
import { loadConfig } from "@holymedia/config";
import {
  evaluateMetaAppReviewPrecondition,
  evaluateMetaAppReviewRenamePolicy,
  invariantChanges,
} from "./meta-app-review-write.policy.js";

const config = loadConfig({
  NODE_ENV: "test",
  V2_META_APP_REVIEW_RENAME_ENABLED: "true",
  V2_META_APP_REVIEW_RENAME_ACCOUNT_ID: "act_1423247033195473",
  V2_META_APP_REVIEW_RENAME_CAMPAIGN_ID: "120251139085310324",
  V2_META_APP_REVIEW_RENAME_EXPECTED_NAME: "hm_saqta_traffic_inst",
  V2_META_APP_REVIEW_RENAME_TARGET_NAME: "hm_saqta_traffic_inst_rename",
});

const validPreview = {
  provider: "META_ADS",
  operation: "change_name",
  externalObjectId: "120251139085310324",
  payload: { new_name: "hm_saqta_traffic_inst_rename" },
};

const paused = {
  id: "120251139085310324",
  accountId: "act_1423247033195473",
  name: "hm_saqta_traffic_inst",
  status: "PAUSED",
  effectiveStatus: "PAUSED",
  objective: "OUTCOME_TRAFFIC",
  dailyBudget: null,
  lifetimeBudget: null,
  buyingType: "AUCTION",
  startTime: null,
  stopTime: null,
};

describe("Meta App Review controlled rename policy", () => {
  it("allows only the exact account, campaign, operation and name", () => {
    expect(
      evaluateMetaAppReviewRenamePolicy(config, validPreview, {
        externalAccountId: "act_1423247033195473",
      }),
    ).toMatchObject({ kind: "allowed" });
  });

  it.each([
    [{ ...validPreview, externalObjectId: "other" }, "campaign_not_allowed"],
    [{ ...validPreview, operation: "pause" }, "operation_not_allowed"],
    [
      { ...validPreview, payload: { new_name: "other" } },
      "target_name_not_allowed",
    ],
    [
      {
        ...validPreview,
        payload: { new_name: "hm_saqta_traffic_inst_rename", status: "PAUSED" },
      },
      "payload_not_name_only",
    ],
  ])("blocks unsupported policy input", (preview, reason) => {
    expect(
      evaluateMetaAppReviewRenamePolicy(config, preview, {
        externalAccountId: "act_1423247033195473",
      }),
    ).toMatchObject({ kind: "blocked", reason });
  });

  it("blocks foreign accounts and campaigns that are not paused", () => {
    expect(
      evaluateMetaAppReviewRenamePolicy(config, validPreview, {
        externalAccountId: "act_other",
      }),
    ).toMatchObject({ kind: "blocked", reason: "account_not_allowed" });
    expect(
      evaluateMetaAppReviewPrecondition(config, {
        ...paused,
        status: "ACTIVE",
      }),
    ).toMatchObject({ kind: "blocked", reason: "campaign_not_paused" });
  });

  it("recognises an already applied rename and reports invariant changes", () => {
    expect(
      evaluateMetaAppReviewPrecondition(config, {
        ...paused,
        name: "hm_saqta_traffic_inst_rename",
      }),
    ).toMatchObject({ kind: "allowed" });
    expect(invariantChanges(paused, { ...paused, name: "new" })).toEqual([]);
    expect(invariantChanges(paused, { ...paused, objective: "OTHER" })).toEqual(
      ["objective"],
    );
  });
});
