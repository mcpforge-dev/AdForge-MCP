import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ProviderCampaign,
  ProviderDateRange,
  ProviderMetricSummary,
  ProviderProvenance,
} from "@holymedia/contracts";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
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
  insights: string[];
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
    const report: PerformanceReport = {
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
      insights: [],
      provenance: {
        summary: summary.provenance,
        campaigns: campaigns.items.map((campaign) => campaign.provenance),
      },
    };
    report.insights = this.reportFindings(metrics);
    return report;
  }

  public async performanceDocx(
    workspaceId: string,
    input: PerformanceReportInput,
  ): Promise<Buffer> {
    const report = await this.performance(workspaceId, input);
    const metrics = report.metrics;
    const metricRows = [
      ["Расход", this.formatMoney(metrics.spend)],
      ["Показы", this.formatMetric(metrics.impressions)],
      ["Клики", this.formatMetric(metrics.clicks)],
      ["CTR", this.formatPercent(metrics.ctr)],
      ["Средняя стоимость клика", this.formatMoney(metrics.cpc)],
      ["CPM", this.formatMoney(metrics.cpm)],
      ["Конверсии", this.formatMetric(metrics.conversions)],
      ["Стоимость конверсии", this.formatMoney(metrics.costPerConversion)],
      [
        "Ценность конверсий",
        metrics.conversionValue === null
          ? "Нет данных"
          : `${this.formatMetric(metrics.conversionValue)}${report.account.currency ? ` ${report.account.currency}` : ""}`,
      ],
    ];
    const campaigns = [...report.campaigns]
      .sort(
        (left, right) =>
          Number(right.metrics?.spend?.amount ?? 0) -
          Number(left.metrics?.spend?.amount ?? 0),
      )
      .slice(0, 50);
    const campaignRows = campaigns.map((campaign) => [
      this.clip(campaign.name || campaign.id, 54),
      campaign.status ?? "Нет данных",
      this.formatMoney(campaign.budget),
      this.formatMoney(campaign.metrics?.spend ?? null),
      this.formatMetric(campaign.metrics?.clicks ?? null),
      this.formatMetric(campaign.metrics?.conversions ?? null),
      this.formatPercent(campaign.metrics?.ctr ?? null),
    ]);
    const activeCampaigns = report.campaigns.filter((campaign) =>
      ["ENABLED", "ACTIVE", "RUNNING"].includes(
        String(campaign.status).toUpperCase(),
      ),
    ).length;
    const summaryBullets = report.insights;
    const source = report.provenance.summary;
    const sourceLabel =
      source.realData && source.dataStatus === "live"
        ? "Данные получены через подключённый рекламный провайдер"
        : "Источник вернул неполные или диагностические данные";
    const generatedAt = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(report.generatedAt));

    const document = new Document({
      creator: "HolyMedia MCP",
      title: `Отчёт по рекламному кабинету: ${report.account.name}`,
      subject: "Клиентский отчёт по эффективности рекламы",
      description:
        "Отчёт сформирован на основании данных подключённого провайдера.",
      sections: [
        {
          properties: {
            page: {
              margin: { top: 900, right: 900, bottom: 900, left: 900 },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: "HOLYMEDIA MCP  ·  PERFORMANCE REPORT",
                      color: "64748B",
                      size: 16,
                      bold: true,
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: "Конфиденциальный рабочий отчёт  ·  ",
                    }),
                    new TextRun({ children: [PageNumber.CURRENT] }),
                  ],
                }),
              ],
            }),
          },
          children: [
            new Paragraph({
              spacing: { before: 900, after: 180 },
              children: [
                new TextRun({
                  text: "HOLYMEDIA",
                  bold: true,
                  color: "2563EB",
                  size: 30,
                }),
                new TextRun({
                  text: "  MCP",
                  bold: true,
                  color: "0F172A",
                  size: 30,
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 180 },
              children: [
                new TextRun({
                  text: "Отчёт по рекламному кабинету",
                  bold: true,
                  color: "0F172A",
                  size: 34,
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: `${report.period.startDate} — ${report.period.endDate}`,
                  bold: true,
                  color: "334155",
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 520 },
              children: [
                new TextRun({
                  text: report.account.name,
                  bold: true,
                  size: 21,
                }),
                new TextRun({
                  text: `  ·  ${report.account.provider}  ·  ${report.account.currency ?? "валюта не указана"}`,
                  color: "64748B",
                  size: 19,
                }),
              ],
            }),
            new Paragraph({
              text: "Краткий вывод",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
              spacing: { after: 140 },
              children: [
                new TextRun({
                  text: `${sourceLabel}. За период зафиксировано ${activeCampaigns} активных кампаний из ${report.campaigns.length}.`,
                  color: "334155",
                }),
              ],
            }),
            ...summaryBullets.map(
              (item) =>
                new Paragraph({
                  text: item,
                  bullet: { level: 0 },
                  spacing: { after: 80 },
                }),
            ),
            new Paragraph({
              text: "Основные показатели",
              heading: HeadingLevel.HEADING_2,
            }),
            this.table(["Показатель", "Значение"], metricRows, [3200, 6000]),
            new Paragraph({
              text: "Кампании",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
              text:
                report.campaigns.length > campaigns.length
                  ? `В таблице показаны ${campaigns.length} кампаний с наибольшим расходом из ${report.campaigns.length}.`
                  : "Кампании отсортированы по расходу за выбранный период.",
              spacing: { after: 140 },
            }),
            this.table(
              [
                "Кампания",
                "Статус",
                "Бюджет",
                "Расход",
                "Клики",
                "Конверсии",
                "CTR",
              ],
              campaignRows,
              [2700, 1100, 1200, 1200, 800, 1000, 800],
            ),
            new Paragraph({
              text: "Как читать отчёт",
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
              text: `Отчёт сформирован ${generatedAt} UTC. Источник: ${source.sourceApi}; статус данных: ${source.dataStatus}; время получения: ${source.fetchedAt}.`,
              spacing: { after: 100 },
            }),
            new Paragraph({
              text: "Показатели без значения отмечены как «Нет данных» и не используются для категоричных выводов. Отчёт не содержит OAuth-токены, ключи API или другие секреты.",
            }),
          ],
        },
      ],
    });
    return Packer.toBuffer(document);
  }

  private reportFindings(metrics: ProviderMetricSummary): string[] {
    const findings: string[] = [];
    if (metrics.spend) {
      findings.push(`Расход за период: ${this.formatMoney(metrics.spend)}.`);
    }
    if (metrics.clicks !== null && metrics.impressions !== null) {
      findings.push(
        `Получено ${this.formatMetric(metrics.clicks)} кликов при ${this.formatMetric(metrics.impressions)} показах; CTR составил ${this.formatPercent(metrics.ctr)}.`,
      );
    }
    if (metrics.conversions !== null && metrics.costPerConversion) {
      findings.push(
        `Зафиксировано ${this.formatMetric(metrics.conversions)} конверсий; стоимость конверсии составила ${this.formatMoney(metrics.costPerConversion)}.`,
      );
    }
    if (!findings.length) {
      findings.push(
        "Недостаточно доступных метрик для краткого вывода за выбранный период.",
      );
    }
    return findings.slice(0, 4);
  }

  private formatMetric(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === "") {
      return "Нет данных";
    }
    return new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
    }).format(Number(value));
  }

  private formatMoney(
    value: { amount: string; currency: string | null } | null,
  ): string {
    if (!value) return "Нет данных";
    const amount = this.formatMetric(value.amount);
    return `${amount}${value.currency ? ` ${value.currency}` : ""}`;
  }

  private formatPercent(value: number | null): string {
    if (value === null) return "Нет данных";
    return `${new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
    }).format(value * 100)}%`;
  }

  private clip(value: string, maxLength: number): string {
    return value.length > maxLength
      ? `${value.slice(0, maxLength - 1)}…`
      : value;
  }

  private table(
    headers: string[],
    rows: string[][],
    columnWidths: number[],
  ): Table {
    const border = {
      style: BorderStyle.SINGLE,
      size: 4,
      color: "CBD5E1",
    };
    const cell = (value: string, header = false, index = 0) =>
      new TableCell({
        width: {
          size: columnWidths[index] ?? 1000,
          type: WidthType.DXA,
        },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        verticalAlign: VerticalAlign.CENTER,
        shading: header
          ? { type: ShadingType.SOLID, fill: "1E3A8A" }
          : { type: ShadingType.CLEAR, fill: index % 2 ? "F8FAFC" : "FFFFFF" },
        borders: {
          top: border,
          bottom: border,
          left: border,
          right: border,
        },
        children: [
          new Paragraph({
            spacing: { after: 0 },
            children: [
              new TextRun({
                text: value,
                bold: header,
                color: header ? "FFFFFF" : "1E293B",
                size: header ? 16 : 15,
              }),
            ],
          }),
        ],
      });
    const header = new TableRow({
      children: headers.map((value, index) => cell(value, true, index)),
    });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths,
      layout: TableLayoutType.FIXED,
      rows: [
        header,
        ...rows.map(
          (row) =>
            new TableRow({
              children: row.map((value, index) => cell(value, false, index)),
            }),
        ),
      ],
    });
  }
}
