import { describe, expect, it, vi } from "vitest";
import { buildAnalysis, SiteAnalysisService } from "./site-analysis.service.js";

describe("site analysis SSRF boundary", () => {
  it("rejects internal and non-HTTP targets before fetching", async () => {
    const service = new SiteAnalysisService();
    await expect(service.analyze("http://127.0.0.1/admin")).rejects.toThrow();
    await expect(
      service.analyze("http://localhost:4000/ready"),
    ).rejects.toThrow();
    await expect(service.analyze("file:///etc/passwd")).rejects.toThrow();
    expect(vi.isMockFunction(fetch)).toBe(false);
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
