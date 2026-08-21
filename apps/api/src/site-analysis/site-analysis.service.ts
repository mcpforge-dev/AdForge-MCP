import { lookup } from "node:dns/promises";
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
import { DatabaseService } from "../infrastructure/database.service.js";

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

@Injectable()
export class SiteAnalysisService {
  public constructor(
    @Optional()
    @Inject(DatabaseService)
    private readonly database?: DatabaseService,
  ) {}

  public async analyze(
    rawUrl: string,
    context?: { workspaceId: string; userId: string },
  ) {
    let url = await this.validateUrl(rawUrl);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS)
        throw new BadRequestException("Слишком много перенаправлений.");
      url = await this.validateUrl(new URL(location, url).toString());
    }
    if (!response)
      throw new BadRequestException("Не удалось получить страницу.");
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html"))
      throw new BadRequestException("URL не вернул HTML-страницу.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES)
      throw new BadRequestException(
        "Страница превышает допустимый размер анализа.",
      );
    const html = new TextDecoder().decode(bytes);
    const title = match(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description =
      match(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
      ) ??
      match(
        html,
        /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
      );
    const h1Count = (html.match(/<h1\b/gi) ?? []).length;
    const links = (html.match(/<a\b[^>]*href=["'][^"']+["']/gi) ?? []).length;
    const result = {
      url,
      status: response.status,
      contentType,
      title: title ? decodeHtml(title).trim() : null,
      description: description ? decodeHtml(description).trim() : null,
      h1Count,
      linkCount: links,
      checks: {
        https: url.startsWith("https://"),
        hasTitle: Boolean(title?.trim()),
        hasDescription: Boolean(description?.trim()),
        hasSingleH1: h1Count === 1,
      },
      source: "live_http_fetch",
      fetchedAt: new Date().toISOString(),
    };
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
              text: "Источник: live HTTP fetch. Документ не содержит OAuth-токены и секреты.",
            }),
          ],
        },
      ],
    });
    return Packer.toBuffer(document);
  }

  private async validateUrl(rawUrl: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException("Некорректный URL.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new BadRequestException("Разрешены только публичные HTTP(S) URL.");
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "metadata.google.internal"
    )
      throw new BadRequestException("Внутренний адрес недоступен для анализа.");
    let addresses;
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException("Не удалось проверить адрес сайта.");
    }
    if (
      !addresses.length ||
      addresses.some((entry) => isPrivateAddress(entry.address))
    )
      throw new BadRequestException(
        "URL указывает на закрытый или внутренний адрес.",
      );
    url.hash = "";
    return url.toString();
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

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isPrivateAddress(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  )
    return true;
  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return false;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}
