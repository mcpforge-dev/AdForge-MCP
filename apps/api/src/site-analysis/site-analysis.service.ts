import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
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
import { safeGet } from "@holymedia/site-audit";
import { loadConfig } from "@holymedia/config";
import { DatabaseService } from "../infrastructure/database.service.js";

const MAX_BYTES = 1_500_000;

export type SiteAnalysisInput = {
  url: string;
  mode?: "quick" | "full";
  siteType?: string;
  goal?: string;
  audience?: string;
  region?: string;
  competitor?: string;
  concern?: string;
};

@Injectable()
export class SiteAnalysisService {
  public constructor(
    @Optional()
    @Inject(DatabaseService)
    private readonly database?: DatabaseService,
  ) {}

  public async analyze(
    input: SiteAnalysisInput | string,
    context?: { workspaceId: string; userId: string },
  ) {
    if (!loadConfig().siteAuditProductEnabled) {
      throw new BadRequestException("Анализ сайта временно недоступен.");
    }
    const brief: SiteAnalysisInput =
      typeof input === "string" ? { url: input } : input;
    const response = await safeGet(brief.url, {
      accept: "text/html,application/xhtml+xml",
      maxBytes: MAX_BYTES,
      maxRedirects: 3,
      timeoutMs: 15_000,
      userAgent: "HolyMediaSiteAnalysis/2.0 (+https://mcp.holymedia.kz)",
    }).catch(() => {
      throw new BadRequestException(
        "Не удалось безопасно получить публичную страницу.",
      );
    });
    const url = response.url;
    const contentType = header(response.headers, "content-type") ?? "";
    if (!contentType.includes("text/html"))
      throw new BadRequestException("URL не вернул HTML-страницу.");
    const html = response.body.toString("utf8");
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value))
        value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, String(value));
    }
    const result = buildAnalysis({
      html,
      url,
      status: response.statusCode,
      contentType,
      brief,
      headers,
    });
    if (context && this.database) {
      await this.database.client.siteAnalysisRecord.create({
        data: {
          workspaceId: context.workspaceId,
          userId: context.userId,
          url: result.url,
          result,
        },
      });
    }
    return result;
  }

  public async history(workspaceId: string, userId: string) {
    if (!this.database) return { items: [] };
    const rows = await this.database.client.siteAnalysisRecord.findMany({
      where: { workspaceId, userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, url: true, result: true, createdAt: true },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        url: row.url,
        result: row.result,
        created_at: row.createdAt.toISOString(),
      })),
    };
  }

  public async reportDocx(
    workspaceId: string,
    userId: string,
    recordId: string,
  ): Promise<Buffer> {
    if (!this.database)
      throw new NotFoundException("Analysis record not found.");
    const row = await this.database.client.siteAnalysisRecord.findFirst({
      where: { id: recordId, workspaceId, userId },
      select: { url: true, result: true, createdAt: true },
    });
    if (!row) throw new NotFoundException("Analysis record not found.");
    const result = objectValue(row.result);
    const checks = objectValue(result.checks);
    const overview = objectValue(result.overview);
    const topIssues = arrayValue(result.topIssues);
    const quickWins = arrayValue(result.quickWins);
    const rows = [
      ["URL", String(row.url)],
      ["HTTP status", String(result.status ?? "нет данных")],
      ["Title", String(result.title ?? "нет данных")],
      ["Description", String(result.description ?? "нет данных")],
      ["H1", String(result.h1Count ?? "нет данных")],
      ["Links", String(result.linkCount ?? "нет данных")],
      ["HTTPS", checks.https === true ? "Да" : "Нет"],
      ["Single H1", checks.hasSingleH1 === true ? "Да" : "Нет"],
    ];
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: "HOLYMEDIA MCP",
              heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
              text: "Отчёт анализа сайта",
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Дата: ${row.createdAt.toISOString()}`,
                  bold: true,
                }),
              ],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: rows.map(
                ([label, value]) =>
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [new Paragraph(String(label))],
                      }),
                      new TableCell({
                        children: [new Paragraph(String(value))],
                      }),
                    ],
                  }),
              ),
            }),
            new Paragraph({
              text: String(overview.verdict ?? "Краткий вывод отсутствует."),
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
              text: "Что проверить в первую очередь",
              heading: HeadingLevel.HEADING_2,
            }),
            ...topIssues.slice(0, 5).map(
              (issue) =>
                new Paragraph({
                  text: `${String(objectValue(issue).title ?? "Проверка")}: ${String(objectValue(issue).recommendation ?? "")}`,
                  bullet: { level: 0 },
                }),
            ),
            new Paragraph({
              text: "Быстрые улучшения",
              heading: HeadingLevel.HEADING_2,
            }),
            ...quickWins.slice(0, 5).map(
              (item) =>
                new Paragraph({
                  text: String(objectValue(item).title ?? "Улучшение"),
                  bullet: { level: 0 },
                }),
            ),
            new Paragraph({
              text: "Источник: безопасный HTTP-анализ публичной страницы. Проверка не выполняет вход на сайт и не содержит OAuth-токены или секреты.",
            }),
          ],
        },
      ],
    });
    return Packer.toBuffer(document);
  }
}

function match(html: string, expression: RegExp): string | null {
  return expression.exec(html)?.[1] ?? null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function buildAnalysis(input: {
  html: string;
  url: string;
  status: number;
  contentType: string;
  brief: SiteAnalysisInput;
  headers: Headers;
}) {
  const title = match(input.html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    match(
      input.html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    ) ??
    match(
      input.html,
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    );
  const h1 = match(input.html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Count = (input.html.match(/<h1\b/gi) ?? []).length;
  const h2Count = (input.html.match(/<h2\b/gi) ?? []).length;
  const links = (input.html.match(/<a\b[^>]*href=["'][^"']+["']/gi) ?? [])
    .length;
  const imageTags = input.html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesWithoutAlt = imageTags.filter(
    (tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag),
  ).length;
  const formCount = (input.html.match(/<form\b/gi) ?? []).length;
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(input.html);
  const canonical = /<link[^>]+rel=["']canonical["']/i.test(input.html);
  const structuredData = /application\/ld\+json/i.test(input.html);
  const ctaCount = (
    input.html.match(
      /<(a|button)\b[^>]*>[^<]*(купить|заказать|оставить заявку|записаться|получить|связаться|начать)[^<]*<\/(a|button)>/gi,
    ) ?? []
  ).length;
  const checks = {
    https: input.url.startsWith("https://"),
    hasTitle: Boolean(title?.trim()),
    hasDescription: Boolean(description?.trim()),
    hasSingleH1: h1Count === 1,
    hasViewport: viewport,
    hasCanonical: canonical,
    hasStructuredData: structuredData,
    hasContactAction: ctaCount > 0 || formCount > 0,
  };
  const scores = [
    score(
      "first-screen",
      "Первый экран",
      100 - (h1Count === 1 ? 0 : 30) - (ctaCount || formCount ? 0 : 20),
      "Заголовок и понятное действие",
    ),
    score(
      "structure",
      "Структура",
      100 - (title ? 0 : 25) - (description ? 0 : 20) - (h2Count ? 0 : 10),
      "Заголовки, title и описание",
    ),
    score(
      "mobile",
      "Мобильная версия",
      viewport ? 90 : 45,
      "Метатег viewport в HTML",
    ),
    score(
      "technical",
      "Техническая основа",
      100 -
        (checks.https ? 0 : 35) -
        (canonical ? 0 : 10) -
        (structuredData ? 0 : 10),
      "HTTPS и базовая разметка",
    ),
  ];
  const topIssues = [
    !checks.hasSingleH1
      ? issue(
          "P1",
          "Проверьте главный заголовок",
          "На странице должен быть один понятный H1.",
          h1Count ? `Найдено H1: ${h1Count}.` : "H1 не найден.",
          "Сформулируйте один главный заголовок под задачу посетителя.",
        )
      : null,
    !checks.hasDescription
      ? issue(
          "P2",
          "Добавьте описание страницы",
          "Поиску и посетителю не хватает короткого описания.",
          "Meta description не найден.",
          "Напишите описание на 120–160 символов с пользой страницы.",
        )
      : null,
    !checks.hasContactAction
      ? issue(
          "P1",
          "Сделайте следующее действие заметным",
          "Посетителю некуда перейти после знакомства с предложением.",
          "Форма и явные CTA не найдены в HTML.",
          "Добавьте одно понятное действие рядом с ключевым предложением.",
        )
      : null,
    imagesWithoutAlt > 0
      ? issue(
          "P2",
          "Опишите изображения",
          "Часть изображений недоступна без текстовой альтернативы.",
          `Изображений без alt: ${imagesWithoutAlt}.`,
          "Добавьте полезные alt-тексты для смысловых изображений.",
        )
      : null,
    !checks.hasViewport
      ? issue(
          "P1",
          "Подготовьте страницу для мобильных",
          "Без viewport мобильный браузер может отобразить страницу неправильно.",
          "Meta viewport не найден.",
          "Добавьте стандартный viewport в head.",
        )
      : null,
  ].filter(Boolean);
  const quickWins = [
    {
      title: checks.hasSingleH1
        ? "Сверьте H1 с задачей посетителя"
        : "Добавьте один главный H1",
    },
    {
      title: checks.hasDescription
        ? "Сократите описание до конкретной пользы"
        : "Добавьте meta description",
    },
    {
      title: checks.hasContactAction
        ? "Проверьте, видно ли основное действие без прокрутки"
        : "Добавьте заметную кнопку или форму",
    },
  ];
  const normalizedTitle = title
    ? decodeHtml(title).trim()
    : "Название страницы";
  const normalizedH1 = h1 ? decodeHtml(h1).trim() : normalizedTitle;
  const goal = input.brief.goal?.trim() || "получать обращения";
  const overview = {
    verdict:
      topIssues.length > 2
        ? "Страница доступна, но ей нужны базовые правки перед запуском рекламы."
        : "Базовая структура страницы выглядит рабочей; проверьте смысл и заметность ключевого действия.",
    mainRisk:
      typeof objectValue(topIssues[0]).title === "string"
        ? String(objectValue(topIssues[0]).title)
        : "Проверьте соответствие предложения целевой аудитории.",
    quickWin: quickWins[0]?.title ?? null,
  };
  return {
    url: input.url,
    status: input.status,
    contentType: input.contentType,
    title: title ? decodeHtml(title).trim() : null,
    description: description ? decodeHtml(description).trim() : null,
    h1Count,
    h2Count,
    linkCount: links,
    imageCount: imageTags.length,
    imagesWithoutAlt,
    formCount,
    brief: {
      mode: input.brief.mode === "full" ? "full" : "quick",
      siteType: input.brief.siteType || null,
      goal: input.brief.goal || null,
      audience: input.brief.audience || null,
      region: input.brief.region || null,
      competitor: input.brief.competitor || null,
      concern: input.brief.concern || null,
    },
    checks,
    scores,
    overview,
    topIssues,
    quickWins,
    hero: {
      h1: normalizedH1,
      subtitle: `Помогите посетителю понять, как страница помогает ${goal}.`,
      cta: checks.hasContactAction
        ? "Сохраните главное действие заметным"
        : "Добавьте понятную кнопку действия",
    },
    structure: [
      "Первый экран",
      "Доказательства и выгоды",
      "Как это работает",
      "Ответы на вопросы",
      "Повторное действие",
    ],
    oneDayPlan: quickWins.map((item, index) => ({
      step: index + 1,
      title: item.title,
    })),
    questions: [
      input.brief.audience
        ? null
        : "Кто ваш основной посетитель и с какой задачей он приходит?",
      input.brief.goal
        ? null
        : "Какое одно действие должен совершить посетитель?",
      input.brief.concern
        ? null
        : "Что на странице вызывает наибольшие сомнения?",
    ].filter(Boolean),
    evidence: {
      source: "live_http_fetch",
      fetchedAt: new Date().toISOString(),
      limitations:
        "Анализирует безопасно полученный HTML публичной страницы. Он не входит в личные кабинеты и не подменяет ручную проверку рендеринга в браузере.",
      headers: {
        contentSecurityPolicy: Boolean(
          input.headers.get("content-security-policy"),
        ),
        xFrameOptions: Boolean(input.headers.get("x-frame-options")),
      },
    },
  };
}

function score(id: string, label: string, value: number, description: string) {
  return { id, label, value: Math.max(0, Math.min(100, value)), description };
}

function issue(
  priority: string,
  title: string,
  problem: string,
  evidence: string,
  recommendation: string,
) {
  return { priority, title, problem, evidence, recommendation };
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
