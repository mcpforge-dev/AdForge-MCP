import { BadRequestException, ConflictException } from "@nestjs/common";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ReportService } from "./report.service.js";

describe("V2 performance reports", () => {
  it("builds source-backed DOCX and PPTX reports without exposing credentials", async () => {
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
            connection: { status: "CONNECTED" },
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
    const presentation = await service.performancePptx("workspace-a", {
      accountId: "1234567890",
      startDate: "2026-01-01",
      endDate: "2026-01-07",
    });
    expect(presentation.subarray(0, 2).toString()).toBe("PK");
    expect(presentation.toString("utf8")).not.toContain("accessToken");
    const archive = await JSZip.loadAsync(presentation);
    const slides = Object.keys(archive.files).filter((path) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path),
    );
    expect(slides).toHaveLength(6);
    expect(
      await archive.file("ppt/presentation.xml")?.async("string"),
    ).toContain("p:sldIdLst");
  });

  it("uses an equal previous period when the report form does not send one", async () => {
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-internal",
            connectionId: "connection-1",
            provider: "META_ADS",
            externalAccountId: "act_123",
            displayName: "Test account",
            currency: "USD",
            timezone: "UTC",
            connection: { status: "CONNECTED" },
          }),
        },
      },
    } as never;
    const providers = {
      readAccountSummary: async () => ({
        provenance: {
          provider: "META_ADS",
          sourceApi: "fixture",
          realData: true,
          dataStatus: "live",
          fetchedAt: new Date().toISOString(),
        },
      }),
      readMetrics: async () => ({
        spend: null,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        cpc: null,
        cpm: null,
        conversions: 0,
        conversionValue: null,
        costPerConversion: null,
      }),
      readCampaigns: async () => ({ items: [], nextCursor: undefined }),
    } as never;
    const report = await new ReportService(database, providers).performance(
      "workspace-a",
      {
        accountId: "act_123",
        startDate: "2026-01-08",
        endDate: "2026-01-14",
      },
    );
    expect(report.comparison?.period).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-01-07",
    });
  });

  it("does not try to generate a performance report for discovery-only providers", async () => {
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-internal",
            connectionId: "connection-1",
            provider: "YANDEX_DIRECT",
            externalAccountId: "client-login",
            displayName: "Yandex account",
            currency: null,
            timezone: null,
            connection: { status: "CONNECTED" },
          }),
        },
      },
    } as never;
    const providers = {} as never;
    await expect(
      new ReportService(database, providers).performance("workspace-a", {
        accountId: "client-login",
        startDate: "2026-01-01",
        endDate: "2026-01-07",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires the same enabled account state used by Connections", async () => {
    let lookup: Record<string, unknown> | undefined;
    const database = {
      client: {
        providerAccount: {
          findFirst: async (input: { where: Record<string, unknown> }) => {
            lookup = input.where;
            return null;
          },
        },
      },
    } as never;

    await expect(
      new ReportService(database, {} as never).performance("workspace-a", {
        accountId: "account-a",
        startDate: "2026-01-01",
        endDate: "2026-01-07",
      }),
    ).rejects.toThrow("Provider account not found.");
    expect(lookup).toMatchObject({
      workspaceId: "workspace-a",
      enabled: true,
    });
  });

  it("tells the client to reconnect instead of treating a stale account as unselected", async () => {
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-internal",
            connectionId: "connection-1",
            provider: "GOOGLE_ADS",
            externalAccountId: "1234567890",
            displayName: "Google account",
            currency: "USD",
            timezone: "UTC",
            connection: { status: "REAUTH_REQUIRED" },
          }),
        },
      },
    } as never;

    await expect(
      new ReportService(database, {} as never).performance("workspace-a", {
        accountId: "account-internal",
        startDate: "2026-01-01",
        endDate: "2026-01-07",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("tells the client to reconnect when a degraded connection has an OAuth failure", async () => {
    const database = {
      client: {
        providerAccount: {
          findFirst: async () => ({
            id: "account-internal",
            connectionId: "connection-1",
            provider: "GOOGLE_ADS",
            externalAccountId: "1234567890",
            displayName: "Google account",
            currency: "USD",
            timezone: "UTC",
            connection: {
              status: "DEGRADED",
              lastErrorCode: "refresh_failed:invalid_grant",
            },
          }),
        },
      },
    } as never;

    await expect(
      new ReportService(database, {} as never).performance("workspace-a", {
        accountId: "account-internal",
        startDate: "2026-01-01",
        endDate: "2026-01-07",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
