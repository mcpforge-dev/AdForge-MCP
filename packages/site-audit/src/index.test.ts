import { describe, expect, it } from "vitest";
import {
  computeAudit,
  isBlockedIp,
  parseAuditPage,
  performanceReportNotes,
} from "./index.js";

describe("site audit V3 scoring", () => {
  it("never awards 100 to a fixture with explicit SEO and accessibility regressions", () => {
    const page = parseAuditPage(
      "https://public.example/",
      200,
      `<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Первый</h1><h1>Второй</h1><h1>Третий</h1><img src="broken.jpg"><a href="">Пустая ссылка</a></body></html>`,
    );
    const audit = computeAudit({ url: page.url, primaryGoal: "Заявки" }, [
      page,
    ]);
    expect(
      audit.scores.find((score) => score.id === "seo")?.value,
    ).toBeLessThan(100);
    expect(
      audit.scores.find((score) => score.id === "accessibility")?.value,
    ).toBeLessThan(100);
    expect(
      audit.scores.find((score) => score.id === "seo")?.findingCount,
    ).toBeGreaterThan(0);
    expect(audit.scores.find((score) => score.id === "ux")?.value).toBeLessThan(
      100,
    );
  });

  it("blocks private, link-local and documentation-only network ranges", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("192.168.1.10")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });

  it("writes an honest partial-performance note for DOCX instead of a fake desktop zero", () => {
    const notes = performanceReportNotes([
      {
        category: "performance",
        metricKey: "mobile_lighthouse_performance",
        label: "Lighthouse Performance (mobile)",
        value: 26,
        unit: "/100",
        evidenceKind: "MEASURED",
        source: "Lighthouse mobile",
      },
      {
        category: "performance",
        metricKey: "desktop_measurement_state",
        label: "Performance measurement (desktop)",
        value: "measurement_failed",
        evidenceKind: "MEASURED",
        source: "Lighthouse desktop",
      },
    ]);
    expect(notes.mobile).toContain("26 / 100");
    expect(notes.desktop).toContain("измерение недоступно");
    expect(notes.desktop).not.toContain("0");
  });
});
