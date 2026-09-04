import { describe, expect, it, vi } from "vitest";
import { buildAnalysis, SiteAnalysisService } from "./site-analysis.service.js";

const safeGetMock = vi.hoisted(() => vi.fn());
const configState = vi.hoisted(() => ({ siteAuditProductEnabled: true }));

vi.mock("@holymedia/site-audit", () => ({ safeGet: safeGetMock }));
vi.mock("@holymedia/config", () => ({ loadConfig: () => configState }));

describe("site analysis SSRF boundary", () => {
  it("delegates URL validation and bounded fetching to the hardened fetcher", async () => {
    configState.siteAuditProductEnabled = true;
    safeGetMock.mockRejectedValue(new Error("blocked"));
    const service = new SiteAnalysisService();
    await expect(service.analyze("https://example.com/")).rejects.toThrow();
    expect(safeGetMock).toHaveBeenCalledTimes(1);
    expect(safeGetMock).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({
        maxBytes: 1_500_000,
        maxRedirects: 3,
        timeoutMs: 15_000,
      }),
    );
  });

  it("blocks legacy analysis creation while the product is disabled", async () => {
    configState.siteAuditProductEnabled = false;
    safeGetMock.mockClear();
    await expect(
      new SiteAnalysisService().analyze("https://example.com"),
    ).rejects.toThrow("Анализ сайта временно недоступен.");
    expect(safeGetMock).not.toHaveBeenCalled();
    configState.siteAuditProductEnabled = true;
  });
});

describe("site analysis result", () => {
  it("returns a structured, non-fictional V1-like result from public HTML", () => {
    const result = buildAnalysis({
      html: `
        <html><head><title>Новый сайт</title><meta name="viewport" content="width=device-width"><meta name="description" content="Короткое описание"><link rel="canonical" href="https://example.com"></head>
        <body><h1>Получите консультацию</h1><h2>Почему мы</h2><a href="/contact">Оставить заявку</a><img src="team.jpg"></body></html>
      `,
      url: "https://example.com/",
      status: 200,
      contentType: "text/html",
      brief: { url: "https://example.com/", mode: "full", goal: "Заявки" },
      headers: new Headers(),
    });

    expect(result.brief.mode).toBe("full");
    expect(result.scores).toHaveLength(4);
    expect(result.topIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Опишите изображения" }),
      ]),
    );
    expect(result.hero.h1).toBe("Получите консультацию");
    expect(result.evidence.limitations).toContain("HTML");
  });
});
