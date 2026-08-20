import type {
  ProviderDateRange,
  ProviderMetricSummary,
  ProviderMoney,
  ProviderProvenance,
} from "@holymedia/contracts";
import { ProviderError } from "./provider.errors.js";

export function validateDateRange(range: ProviderDateRange): ProviderDateRange {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(range.startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(range.endDate)
  ) {
    throw new ProviderError(
      "provider_response_invalid",
      "Date range must use YYYY-MM-DD.",
    );
  }
  if (range.startDate > range.endDate) {
    throw new ProviderError(
      "provider_response_invalid",
      "Date range is reversed.",
    );
  }
  return range;
}

export function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function decimalString(value: unknown): string | null {
  const number = numberValue(value);
  return number === null
    ? null
    : number.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function money(
  value: unknown,
  currency: string | null,
): ProviderMoney | null {
  const amount = decimalString(value);
  return amount === null ? null : { amount, currency };
}

export function emptyMetrics(): ProviderMetricSummary {
  return {
    spend: null,
    impressions: null,
    clicks: null,
    ctr: null,
    cpc: null,
    cpm: null,
    conversions: null,
    conversionValue: null,
    costPerConversion: null,
  };
}

export function metricsFromRaw(
  raw: Record<string, unknown>,
  currency: string | null,
  spendValue: unknown,
  conversionsValue: unknown = raw.conversions,
): ProviderMetricSummary {
  const spend = numberValue(spendValue);
  const impressions = numberValue(raw.impressions);
  const clicks = numberValue(raw.clicks);
  const conversions = numberValue(conversionsValue);
  const ctr =
    numberValue(raw.ctr) ??
    (impressions && clicks !== null ? clicks / impressions : null);
  const cpc =
    numberValue(raw.cpc) ?? (spend !== null && clicks ? spend / clicks : null);
  const cpm =
    numberValue(raw.cpm) ??
    (spend !== null && impressions ? (spend / impressions) * 1000 : null);
  const costPerConversion =
    numberValue(raw.costPerConversion) ??
    (spend !== null && conversions ? spend / conversions : null);
  return {
    spend: money(spend, currency),
    impressions,
    clicks,
    ctr,
    cpc: money(cpc, currency),
    cpm: money(cpm, currency),
    conversions,
    conversionValue: decimalString(raw.conversionValue),
    costPerConversion: money(costPerConversion, currency),
  };
}

export function provenance(
  provider: ProviderProvenance["provider"],
  sourceApi: string,
  dataStatus: ProviderProvenance["dataStatus"] = "live",
): ProviderProvenance {
  return {
    provider,
    sourceApi,
    realData: true,
    dataStatus,
    fetchedAt: new Date().toISOString(),
  };
}

export function sumMetrics(
  rows: Array<{ raw: Record<string, unknown>; spend: unknown }>,
  currency: string | null,
): ProviderMetricSummary {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const field of [
      "impressions",
      "clicks",
      "conversions",
      "conversionValue",
    ]) {
      const value = numberValue(row.raw[field]);
      if (value !== null) totals[field] = (totals[field] ?? 0) + value;
    }
    const spend = numberValue(row.spend);
    if (spend !== null) totals.spend = (totals.spend ?? 0) + spend;
  }
  return metricsFromRaw(totals, currency, totals.spend);
}
