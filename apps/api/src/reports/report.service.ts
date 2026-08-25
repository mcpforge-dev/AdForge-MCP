import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  ProviderCampaign,
  ProviderDateRange,
  ProviderMoney,
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
import JSZip from "jszip";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ProviderService } from "../providers/provider.service.js";
import { ProviderError } from "../providers/provider.errors.js";

export type PerformanceReportInput = {
  accountId: string;
  startDate: string;
  endDate: string;
  previousStartDate?: string;
  previousEndDate?: string;
};

export type PerformanceMetricChange = {
  current: unknown;
  previous: unknown;
  absolute: number | null;
  percent: number | null;
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
  comparison?: {
    period: ProviderDateRange;
    metrics: ProviderMetricSummary;
    changes: Record<string, PerformanceMetricChange>;
  };
  provenance: {
    summary: ProviderProvenance;
    campaigns: ProviderProvenance[];
  };
};

const REPORT_PROVIDERS = new Set(["GOOGLE_ADS", "META_ADS"]);
const REAUTH_ERROR_PREFIXES = [
  "authentication_failed",
  "refresh_failed",
  "connection_revoked",
  "token_expired",
  "insufficient_permissions",
];
const PPT = {
  purple: "42195C",
  purpleLight: "F1EAF6",
  purplePale: "FAF7FC",
  ink: "28252C",
  muted: "716A78",
  white: "FFFFFF",
};
const EMU = 914_400;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

class PptSlide {
  private id = 2;
  private readonly shapes: string[] = [];

  public rect(x: number, y: number, w: number, h: number, fill: string): void {
    this.shape(x, y, w, h, fill, "rect");
  }

  public ellipse(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
  ): void {
    this.shape(x, y, w, h, fill, "ellipse");
  }

  public text(
    x: number,
    y: number,
    w: number,
    h: number,
    value: string,
    options: {
      color?: string;
      fontSize?: number;
      bold?: boolean;
      align?: "l" | "ctr" | "r";
    } = {},
  ): void {
    const id = this.id++;
    const size = Math.round((options.fontSize ?? 14) * 100);
    const weight = options.bold ? ' b="1"' : "";
    const align = options.align ? ` algn="${options.align}"` : "";
    const color = options.color ?? PPT.ink;
    const paragraphs = value
      .split("\n")
      .map(
        (line) =>
          `<a:p><a:pPr${align}/><a:r><a:rPr lang="ru-RU" sz="${size}"${weight}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Aptos"/></a:rPr><a:t>${escapeXml(line)}</a:t></a:r></a:p>`,
      )
      .join("");
    this.shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x * EMU)}" y="${Math.round(y * EMU)}"/><a:ext cx="${Math.round(w * EMU)}" cy="${Math.round(h * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`,
    );
  }

  public xml(): string {
    return `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${this.shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  private shape(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    geometry: "rect" | "ellipse",
  ): void {
    const id = this.id++;
    this.shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x * EMU)}" y="${Math.round(y * EMU)}"/><a:ext cx="${Math.round(w * EMU)}" cy="${Math.round(h * EMU)}"/></a:xfrm><a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`,
    );
  }
}

async function pptxBuffer(
  title: string,
  build: (add: (slide: PptSlide) => void) => void,
): Promise<Buffer> {
  const slides: string[] = [];
  build((slide) => slides.push(slide.xml()));
  const zip = new JSZip();
  const overrides = slides
    .map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");
  const relationships = slides
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
    )
    .join("");
  const ids = slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${overrides}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(title)}</dc:title><dc:creator>HolyMedia MCP</dc:creator></cp:coreProperties>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${relationships}</Relationships>`,
  );
  zip.file(
    "ppt/theme/theme1.xml",
    '<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="HolyMedia"><a:themeElements><a:clrScheme name="HolyMedia"><a:dk1><a:srgbClr val="28252C"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="42195C"/></a:dk2><a:lt2><a:srgbClr val="F1EAF6"/></a:lt2><a:accent1><a:srgbClr val="42195C"/></a:accent1><a:accent2><a:srgbClr val="7B4A96"/></a:accent2><a:accent3><a:srgbClr val="198754"/></a:accent3><a:accent4><a:srgbClr val="A66A00"/></a:accent4><a:hlink><a:srgbClr val="42195C"/></a:hlink><a:folHlink><a:srgbClr val="7B4A96"/></a:folHlink></a:clrScheme><a:fontScheme name="HolyMedia"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="HolyMedia"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>',
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="HolyMedia"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>',
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
  );
  slides.forEach((slide, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, slide);
    zip.file(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
    );
  });
  return Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

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
      },
      include: { connection: true },
    });
    if (!account) throw new NotFoundException("Provider account not found.");
    if (
      account.connection.status === "REAUTH_REQUIRED" ||
      REAUTH_ERROR_PREFIXES.some((prefix) =>
        String(account.connection.lastErrorCode ?? "").startsWith(prefix),
      )
    ) {
      throw new ConflictException("Provider authorization must be renewed.");
    }
    if (account.connection.status !== "CONNECTED") {
      throw new ServiceUnavailableException(
        "Provider connection is unavailable.",
      );
    }
    if (!REPORT_PROVIDERS.has(String(account.provider))) {
      throw new BadRequestException(
        "Performance reports are currently available for Meta Ads and Google Ads accounts.",
      );
    }
    const period: ProviderDateRange = {
      startDate: input.startDate.slice(0, 10),
      endDate: input.endDate.slice(0, 10),
      ...(account.timezone ? { timezone: account.timezone } : {}),
    };
    if (Boolean(input.previousStartDate) !== Boolean(input.previousEndDate)) {
      throw new BadRequestException(
        "Both previous period dates are required for comparison.",
      );
    }
    const previousPeriod =
      input.previousStartDate && input.previousEndDate
        ? {
            startDate: input.previousStartDate.slice(0, 10),
            endDate: input.previousEndDate.slice(0, 10),
            ...(account.timezone ? { timezone: account.timezone } : {}),
          }
        : this.previousPeriod(period);
    let summary;
    let metrics;
    let campaigns;
    let previousMetrics;
    try {
      [summary, metrics, campaigns, previousMetrics] = await Promise.all([
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
        previousPeriod
          ? this.providers.readMetrics(
              workspaceId,
              account.connectionId,
              account.id,
              previousPeriod,
            )
          : Promise.resolve(null),
      ]);
    } catch (error) {
      if (
        error instanceof ProviderError &&
        [
          "authentication_failed",
          "refresh_failed",
          "connection_revoked",
        ].includes(error.code)
      ) {
        throw new ConflictException("Provider authorization must be renewed.");
      }
      if (error instanceof ProviderError) {
        throw new ServiceUnavailableException(
          "Provider report data is unavailable.",
        );
      }
      throw error;
    }
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
    if (previousMetrics && previousPeriod) {
      report.comparison = {
        period: previousPeriod,
        metrics: previousMetrics,
        changes: this.metricChanges(metrics, previousMetrics),
      };
    }
    report.insights = this.reportFindings(metrics);
    if (report.comparison) {
      report.insights.push(...this.comparisonFindings(report.comparison));
    }
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
            ...(report.comparison
              ? [
                  new Paragraph({
                    text: "Сравнение с предыдущим периодом",
                    heading: HeadingLevel.HEADING_2,
                  }),
                  new Paragraph({
                    text: `${report.period.startDate} — ${report.period.endDate} против ${report.comparison.period.startDate} — ${report.comparison.period.endDate}.`,
                    spacing: { after: 140 },
                  }),
                  this.table(
                    ["Показатель", "Текущий", "Предыдущий", "Изменение"],
                    this.comparisonRows(report.comparison),
                    [2800, 2200, 2200, 2000],
                  ),
                ]
              : []),
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

  public async performancePptx(
    workspaceId: string,
    input: PerformanceReportInput,
  ): Promise<Buffer> {
    const report = await this.performance(workspaceId, input);
    const metrics = report.metrics;
    const comparison = report.comparison;
    const currentPeriod = `${report.period.startDate} - ${report.period.endDate}`;
    const providerLabel =
      report.account.provider === "META_ADS" ? "Meta Ads" : "Google Ads";
    const campaignRows = [...report.campaigns]
      .sort(
        (left, right) =>
          Number(right.metrics?.spend?.amount ?? 0) -
          Number(left.metrics?.spend?.amount ?? 0),
      )
      .slice(0, 7)
      .map((campaign) => [
        this.clip(campaign.name || campaign.id, 38),
        campaign.status ?? "Нет данных",
        this.formatMoney(campaign.metrics?.spend ?? null),
        this.formatMetric(campaign.metrics?.clicks ?? null),
        this.formatMetric(campaign.metrics?.conversions ?? null),
      ]);
    const addSlideTitle = (
      slide: PptSlide,
      title: string,
      subtitle?: string,
    ) => {
      slide.text(0.72, 0.45, 11.8, 0.45, title, {
        color: PPT.ink,
        fontSize: 24,
        bold: true,
      });
      if (subtitle) {
        slide.text(0.72, 0.96, 11.8, 0.28, subtitle, {
          color: PPT.muted,
          fontSize: 10,
        });
      }
    };
    const addTable = (
      slide: PptSlide,
      x: number,
      y: number,
      widths: number[],
      headers: string[],
      rows: string[][],
    ) => {
      const rowHeight = 0.36;
      let cursor = x;
      headers.forEach((header, index) => {
        slide.rect(cursor, y, widths[index] ?? 1, rowHeight, PPT.purple);
        slide.text(
          cursor + 0.08,
          y + 0.07,
          (widths[index] ?? 1) - 0.16,
          0.2,
          header,
          {
            color: PPT.white,
            fontSize: 8,
            bold: true,
          },
        );
        cursor += widths[index] ?? 1;
      });
      rows.forEach((row, rowIndex) => {
        cursor = x;
        const fill = rowIndex % 2 === 0 ? PPT.white : PPT.purplePale;
        row.forEach((value, cellIndex) => {
          const width = widths[cellIndex] ?? 1;
          slide.rect(
            cursor,
            y + rowHeight * (rowIndex + 1),
            width,
            rowHeight,
            fill,
          );
          slide.text(
            cursor + 0.08,
            y + rowHeight * (rowIndex + 1) + 0.07,
            width - 0.16,
            0.2,
            value,
            {
              color: PPT.ink,
              fontSize: 8,
            },
          );
          cursor += width;
        });
      });
    };

    return pptxBuffer(
      `Отчёт по рекламному кабинету: ${report.account.name}`,
      (add) => {
        const cover = new PptSlide();
        cover.rect(0, 0, 13.333, 7.5, PPT.purple);
        cover.ellipse(9.6, -1.15, 4.2, 4.2, "6E3889");
        cover.ellipse(10.75, 4.7, 2.1, 2.1, "5A2873");
        cover.text(0.82, 1.35, 8.9, 0.45, "HOLYMEDIA MCP", {
          color: PPT.white,
          fontSize: 16,
          bold: true,
        });
        cover.text(0.82, 2.15, 9.1, 1.15, "Отчёт по рекламному кабинету", {
          color: PPT.white,
          fontSize: 31,
          bold: true,
        });
        cover.text(0.82, 3.55, 8.5, 0.38, report.account.name, {
          color: "EADCF2",
          fontSize: 17,
          bold: true,
        });
        cover.text(
          0.82,
          4.04,
          8.5,
          0.3,
          `${providerLabel}  |  ${currentPeriod}`,
          {
            color: "EADCF2",
            fontSize: 11,
          },
        );
        cover.text(
          0.82,
          6.55,
          8.5,
          0.25,
          "Данные подключённого рекламного кабинета",
          {
            color: "EADCF2",
            fontSize: 9,
          },
        );
        add(cover);

        const kpis = new PptSlide();
        addSlideTitle(
          kpis,
          "Результаты за период",
          `${report.account.name}  |  ${currentPeriod}`,
        );
        const kpiItems: Array<[string, string]> = [
          ["Расход", this.formatMoney(metrics.spend)],
          ["Показы", this.formatMetric(metrics.impressions)],
          ["Клики", this.formatMetric(metrics.clicks)],
          ["Конверсии", this.formatMetric(metrics.conversions)],
          ["CTR", this.formatPercent(metrics.ctr)],
          ["Стоимость конверсии", this.formatMoney(metrics.costPerConversion)],
        ];
        kpiItems.forEach(([label, value], index) => {
          const column = index % 3;
          const row = Math.floor(index / 3);
          const x = 0.72 + column * 4.12;
          const y = 1.55 + row * 2.23;
          kpis.rect(
            x,
            y,
            3.65,
            1.72,
            index === 0 ? PPT.purpleLight : PPT.purplePale,
          );
          kpis.text(x + 0.28, y + 0.3, 3.05, 0.25, label, {
            color: PPT.muted,
            fontSize: 10,
          });
          kpis.text(x + 0.28, y + 0.78, 3.05, 0.48, value, {
            color: PPT.ink,
            fontSize: 20,
            bold: true,
          });
        });
        add(kpis);

        const periodComparison = new PptSlide();
        addSlideTitle(
          periodComparison,
          "Сравнение с предыдущим периодом",
          comparison
            ? `${currentPeriod} против ${comparison.period.startDate} - ${comparison.period.endDate}`
            : "Для выбранного периода нет сравнения",
        );
        if (comparison) {
          addTable(
            periodComparison,
            0.72,
            1.55,
            [3.5, 2.5, 2.5, 2.6],
            ["Показатель", "Текущий", "Предыдущий", "Изменение"],
            this.comparisonRows(comparison),
          );
        } else {
          periodComparison.text(
            0.72,
            1.65,
            8.5,
            0.35,
            "Недостаточно данных для сравнения периодов.",
            {
              color: PPT.muted,
              fontSize: 14,
            },
          );
        }
        add(periodComparison);

        const campaigns = new PptSlide();
        addSlideTitle(
          campaigns,
          "Кампании",
          `Топ кампаний по расходу за ${currentPeriod}`,
        );
        if (campaignRows.length) {
          addTable(
            campaigns,
            0.72,
            1.55,
            [4.2, 1.7, 1.9, 1.5, 1.5],
            ["Кампания", "Статус", "Расход", "Клики", "Конверсии"],
            campaignRows,
          );
        } else {
          campaigns.text(
            0.72,
            1.65,
            8.5,
            0.35,
            "За выбранный период кампании не найдены.",
            {
              color: PPT.muted,
              fontSize: 14,
            },
          );
        }
        add(campaigns);

        const insights = new PptSlide();
        addSlideTitle(
          insights,
          "Ключевые выводы",
          "Выводы сформированы только на основе доступных метрик",
        );
        report.insights.slice(0, 4).forEach((insight, index) => {
          const y = 1.55 + index * 1.15;
          insights.ellipse(0.8, y + 0.06, 0.24, 0.24, PPT.purple);
          insights.text(1.25, y, 10.6, 0.65, insight, {
            color: PPT.ink,
            fontSize: 14,
          });
        });
        add(insights);

        const notes = new PptSlide();
        addSlideTitle(
          notes,
          "Источник и ограничения",
          "Прозрачность данных отчёта",
        );
        const source = report.provenance.summary;
        notes.rect(0.72, 1.48, 11.85, 3.65, PPT.purplePale);
        notes.text(1.05, 1.85, 10.9, 0.35, "Источник", {
          color: PPT.muted,
          fontSize: 10,
          bold: true,
        });
        notes.text(1.05, 2.2, 10.9, 0.4, source.sourceApi, {
          color: PPT.ink,
          fontSize: 15,
          bold: true,
        });
        notes.text(1.05, 2.9, 10.9, 0.35, "Статус данных", {
          color: PPT.muted,
          fontSize: 10,
          bold: true,
        });
        notes.text(
          1.05,
          3.25,
          10.9,
          0.4,
          source.realData && source.dataStatus === "live"
            ? "Получены из подключённого рекламного кабинета"
            : "Данные могут быть неполными",
          { color: PPT.ink, fontSize: 14 },
        );
        notes.text(
          1.05,
          4.1,
          10.9,
          0.52,
          "Отчёт не содержит OAuth-токены, ключи API или другие секреты. Показатели без значения отмечены как «Нет данных» и не используются для категоричных выводов.",
          { color: PPT.muted, fontSize: 10 },
        );
        add(notes);
      },
    );
  }

  private previousPeriod(period: ProviderDateRange): ProviderDateRange {
    const start = new Date(`${period.startDate}T00:00:00.000Z`);
    const end = new Date(`${period.endDate}T00:00:00.000Z`);
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
    if (!Number.isFinite(days) || days <= 0) {
      throw new BadRequestException("The report period is invalid.");
    }
    const previousEnd = new Date(start.getTime() - dayMs);
    const previousStart = new Date(previousEnd.getTime() - (days - 1) * dayMs);
    return {
      startDate: previousStart.toISOString().slice(0, 10),
      endDate: previousEnd.toISOString().slice(0, 10),
      ...(period.timezone ? { timezone: period.timezone } : {}),
    };
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

  private comparisonFindings(
    comparison: NonNullable<PerformanceReport["comparison"]>,
  ): string[] {
    const findings: string[] = [];
    for (const [key, change] of Object.entries(comparison.changes)) {
      if (change.percent === null || Math.abs(change.percent) < 5) continue;
      const label = this.metricLabel(key);
      const direction = change.percent > 0 ? "вырос" : "снизился";
      findings.push(
        `${label} ${direction} на ${this.formatPercentValue(Math.abs(change.percent))} к предыдущему периоду.`,
      );
      if (findings.length === 2) break;
    }
    return findings;
  }

  private metricChanges(
    current: ProviderMetricSummary,
    previous: ProviderMetricSummary,
  ): Record<string, PerformanceMetricChange> {
    const keys = [
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "cpc",
      "cpm",
      "conversions",
      "costPerConversion",
    ] as const;
    return Object.fromEntries(
      keys.map((key) => {
        const currentValue = current[key];
        const previousValue = previous[key];
        const currentNumber = this.metricNumber(currentValue);
        const previousNumber = this.metricNumber(previousValue);
        const absolute =
          currentNumber !== null && previousNumber !== null
            ? currentNumber - previousNumber
            : null;
        return [
          key,
          {
            current: currentValue,
            previous: previousValue,
            absolute,
            percent:
              absolute !== null &&
              previousNumber !== null &&
              previousNumber !== 0
                ? (absolute / Math.abs(previousNumber)) * 100
                : null,
          },
        ];
      }),
    );
  }

  private comparisonRows(
    comparison: NonNullable<PerformanceReport["comparison"]>,
  ): string[][] {
    return Object.entries(comparison.changes).map(([key, change]) => [
      this.metricLabel(key),
      this.formatComparisonValue(key, change.current),
      this.formatComparisonValue(key, change.previous),
      change.percent === null
        ? "Нет сравнения"
        : `${change.percent >= 0 ? "+" : ""}${this.formatPercentValue(change.percent)}`,
    ]);
  }

  private formatComparisonValue(key: string, value: unknown): string {
    if (["spend", "cpc", "cpm", "costPerConversion"].includes(key)) {
      return this.formatMoney((value as ProviderMoney | null) ?? null);
    }
    if (key === "ctr") return this.formatPercent(this.metricNumber(value));
    return this.formatMetric(this.metricNumber(value));
  }

  private metricLabel(key: string): string {
    return (
      {
        spend: "Расход",
        impressions: "Показы",
        clicks: "Клики",
        ctr: "CTR",
        cpc: "Средняя стоимость клика",
        cpm: "CPM",
        conversions: "Конверсии",
        costPerConversion: "Стоимость конверсии",
      }[key] ?? key
    );
  }

  private metricNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value && typeof value === "object" && "amount" in value) {
      const amount = Number((value as { amount?: unknown }).amount);
      return Number.isFinite(amount) ? amount : null;
    }
    return null;
  }

  private formatPercentValue(value: number): string {
    return `${new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
    }).format(value)}%`;
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
