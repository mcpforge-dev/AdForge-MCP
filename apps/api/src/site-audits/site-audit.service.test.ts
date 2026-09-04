import { describe, expect, it, vi } from "vitest";
import { SiteAuditService } from "./site-audit.service.js";

describe("SiteAuditService tenant boundary", () => {
  it("blocks direct audit creation while the product is disabled", async () => {
    const previous = process.env.SITE_AUDIT_PRODUCT_ENABLED;
    delete process.env.SITE_AUDIT_PRODUCT_ENABLED;
    const create = vi.fn();
    const service = new SiteAuditService(
      { client: { siteAudit: { create } } } as never,
      {} as never,
    );
    await expect(
      service.create("workspace-a", "user-a", { url: "https://example.com" }),
    ).rejects.toThrow("Анализ сайта временно недоступен.");
    expect(create).not.toHaveBeenCalled();
    if (previous === undefined) delete process.env.SITE_AUDIT_PRODUCT_ENABLED;
    else process.env.SITE_AUDIT_PRODUCT_ENABLED = previous;
  });

  it("rejects an internal URL before it can create a workspace audit", async () => {
    const previous = process.env.SITE_AUDIT_PRODUCT_ENABLED;
    process.env.SITE_AUDIT_PRODUCT_ENABLED = "true";
    const create = vi.fn();
    const service = new SiteAuditService(
      { client: { siteAudit: { create } } } as never,
      {} as never,
    );
    await expect(
      service.create("workspace-a", "user-a", {
        url: "http://127.0.0.1/admin",
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    if (previous === undefined) delete process.env.SITE_AUDIT_PRODUCT_ENABLED;
    else process.env.SITE_AUDIT_PRODUCT_ENABLED = previous;
  });

  it("scopes private screenshots and reports to the requested workspace", async () => {
    const reportFindFirst = vi.fn().mockResolvedValue({
      data: new Uint8Array([1]),
      mimeType: "application/octet-stream",
    });
    const screenshotFindFirst = vi
      .fn()
      .mockResolvedValue({ data: new Uint8Array([2]), mimeType: "image/png" });
    const service = new SiteAuditService(
      {
        client: {
          siteAuditReport: { findFirst: reportFindFirst },
          siteAuditScreenshot: { findFirst: screenshotFindFirst },
        },
      } as never,
      {} as never,
    );
    await service.report("workspace-a", "audit-a");
    await service.screenshot("workspace-a", "audit-a", "desktop");
    expect(reportFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { auditId: "audit-a", audit: { workspaceId: "workspace-a" } },
      }),
    );
    expect(screenshotFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          auditId: "audit-a",
          audit: { workspaceId: "workspace-a" },
          kind: "DESKTOP_SCREENSHOT",
        },
      }),
    );
  });
});
