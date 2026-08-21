import { lookup } from "node:dns/promises";
import { BadRequestException, Injectable } from "@nestjs/common";

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

@Injectable()
export class SiteAnalysisService {
  public async analyze(rawUrl: string) {
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
    return {
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
