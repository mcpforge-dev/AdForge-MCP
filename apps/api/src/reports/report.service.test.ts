import { describe, expect, it } from "vitest";
import { ReportService } from "./report.service.js";

describe("V2 performance reports", () => {
  it("builds a source-backed report and DOCX without exposing credentials", async () => {
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-internal",
            connectionId: "connection-1",
            provider: "GOOGLE_ADS",
            externalAccountId: "1234567890",
            displayName: "Test account",
            currency: "USD",
            timezone: "UTC",
          }),
        },
      },
    } as never;
    const providers = {
      readAccountSummary: async () => ({
        provenance: {
          provider: "GOOGLE_ADS",
          sourceApi: "fixture",
          realData: true,
          dataStatus: "live",
          fetchedAt: new Date().toISOString(),
        },
      }),
      readMetrics: async () => ({
        spend: { amount: "10", currency: "USD" },
        impressions: 100,
        clicks: 10,
        ctr: 0.1,
        cpc: { amount: "1", currency: "USD" },
        cpm: { amount: "100", currency: "USD" },
        conversions: 1,
        conversionValue: null,
        costPerConversion: { amount: "10", currency: "USD" },
      }),
      readCampaigns: async () => ({
        items: [
          {
            id: "campaign-1",
            name: "Campaign",
            status: "PAUSED",
            objective: null,
            budget: null,
            provenance: {
              provider: "GOOGLE_ADS",
              sourceApi: "fixture",
              realData: true,
              dataStatus: "live",
              fetchedAt: new Date().toISOString(),
            },
          },
        ],
        nextCursor: undefined,
      }),
    } as never;
    const service = new ReportService(database, providers);
    const report = await service.performance("workspace-a", {
      accountId: "1234567890",
      startDate: "2026-01-01",
      endDate: "2026-01-07",
      previousStartDate: "2025-12-25",
      previousEndDate: "2025-12-31",
    });
    expect(report.account.externalAccountId).toBe("1234567890");
    expect(report.metrics.spend?.amount).toBe("10");
    expect(report.provenance.summary.realData).toBe(true);
    expect(report.insights).toEqual(
      expect.arrayContaining([expect.stringContaining("Расход")]),
    );
    expect(report.comparison?.period.startDate).toBe("2025-12-25");
    expect(report.comparison?.changes["spend"]?.absolute).toBe(0);
    const document = await service.performanceDocx("workspace-a", {
      accountId: "1234567890",
      startDate: "2026-01-01",
      endDate: "2026-01-07",
    });
    expect(document.subarray(0, 2).toString()).toBe("PK");
    expect(document.toString("utf8")).not.toContain("accessToken");
  });
});
