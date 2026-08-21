import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ProviderCampaign,
  ProviderDateRange,
  ProviderMetricSummary,
  ProviderProvenance,
} from "@holymedia/contracts";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ProviderService } from "../providers/provider.service.js";

export type PerformanceReportInput = {
  accountId: string;
  startDate: string;
  endDate: string;
};

export type PerformanceReport = {
  reportType: "performance";
  generatedAt: string;
  period: ProviderDateRange;
  account: {
    provider: string;
    externalAccountId: string;
    name: string;
    currency: string | null;
    timezone: string | null;
  };
  metrics: ProviderMetricSummary;
  campaigns: ProviderCampaign[];
  provenance: {
    summary: ProviderProvenance;
    campaigns: ProviderProvenance[];
  };
};

@Injectable()
export class ReportService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProviderService) private readonly providers: ProviderService,
  ) {}

  public async performance(
    workspaceId: string,
    input: PerformanceReportInput,
  ): Promise<PerformanceReport> {
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId,
        enabled: true,
        OR: [{ id: input.accountId }, { externalAccountId: input.accountId }],
        connection: { status: "CONNECTED" },
      },
      include: { connection: true },
    });
    if (!account) throw new NotFoundException("Provider account not found.");
    const period: ProviderDateRange = {
      startDate: input.startDate.slice(0, 10),
      endDate: input.endDate.slice(0, 10),
      ...(account.timezone ? { timezone: account.timezone } : {}),
    };
    const [summary, metrics, campaigns] = await Promise.all([
      this.providers.readAccountSummary(
        workspaceId,
        account.connectionId,
        account.id,
        period,
      ),
      this.providers.readMetrics(
        workspaceId,
        account.connectionId,
        account.id,
        period,
      ),
      this.providers.readCampaigns(
        workspaceId,
        account.connectionId,
        account.id,
        period,
        500,
      ),
    ]);
    return {
      reportType: "performance",
      generatedAt: new Date().toISOString(),
      period,
      account: {
        provider: String(account.provider),
        externalAccountId: account.externalAccountId,
        name: account.displayName,
        currency: account.currency,
        timezone: account.timezone,
      },
      metrics,
      campaigns: campaigns.items,
      provenance: {
        summary: summary.provenance,
        campaigns: campaigns.items.map((campaign) => campaign.provenance),
      },
    };
  }

  public async performanceDocx(
    workspaceId: string,
    input: PerformanceReportInput,
  ): Promise<Buffer> {
    const report = await this.performance(workspaceId, input);
    const metrics = report.metrics;
    const money = (
      value: { amount: string; currency: string | null } | null,
    ) =>
      value
        ? `${value.amount}${value.currency ? ` ${value.currency}` : ""}`
        : "Нет данных";
    const metricRows = [
      ["Расход", money(metrics.spend)],
      ["Показы", String(metrics.impressions ?? "Нет данных")],
      ["Клики", String(metrics.clicks ?? "Нет данных")],
      ["CTR", String(metrics.ctr ?? "Нет данных")],
      ["Средняя стоимость клика", money(metrics.cpc)],
      ["Конверсии", String(metrics.conversions ?? "Нет данных")],
      ["Стоимость конверсии", money(metrics.costPerConversion)],
    ];
    const document = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "HOLYMEDIA MCP",
              heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
              text: "Отчёт по рекламному кабинету",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Период: ${report.period.startDate} — ${report.period.endDate}`,
                  bold: true,
                }),
              ],
            }),
            new Paragraph({
              text: `Кабинет: ${report.account.name} (${report.account.provider})`,
            }),
            new Paragraph({
              text: "Основные показатели",
              heading: HeadingLevel.HEADING_2,
            }),
            this.table(["Показатель", "Значение"], metricRows),
            new Paragraph({
              text: "Кампании",
              heading: HeadingLevel.HEADING_2,
            }),
            this.table(
              ["Кампания", "Статус", "Бюджет"],
              report.campaigns.map((campaign) => [
                campaign.name || campaign.id,
                campaign.status ?? "Нет данных",
                money(campaign.budget),
              ]),
            ),
            new Paragraph({
              text: "Источник: данные получены через подключённый рекламный провайдер HolyMedia MCP. Отчёт не содержит OAuth-токены или секреты.",
            }),
          ],
        },
      ],
    });
    return Packer.toBuffer(document);
  }

  private table(headers: string[], rows: string[][]): Table {
    const header = new TableRow({
      children: headers.map(
        (value) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: value, bold: true })],
              }),
            ],
          }),
      ),
    });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        header,
        ...rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (value) => new TableCell({ children: [new Paragraph(value)] }),
              ),
            }),
        ),
      ],
    });
  }
}
