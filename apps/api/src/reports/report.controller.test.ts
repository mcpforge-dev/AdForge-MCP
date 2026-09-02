import { describe, expect, it, vi } from "vitest";
import { ReportController } from "./report.controller.js";
import { PerformanceReportDto } from "./report.dto.js";

const input = {
  accountId: "account-a",
  startDate: "2026-01-01",
  endDate: "2026-01-07",
};

function setup() {
  const reports = {
    performance: vi.fn(),
    performanceDocx: vi.fn(async () => Buffer.from("PK")),
    performancePptx: vi.fn(async () => Buffer.from("PK")),
  };
  const billing = { requireFeature: vi.fn(async () => undefined) };
  return {
    controller: new ReportController(reports as never, billing as never),
    reports,
    billing,
  };
}

describe("performance report downloads", () => {
  it("keeps the query DTO available to Nest at runtime", () => {
    expect(
      Reflect.getMetadata(
        "design:paramtypes",
        ReportController.prototype,
        "performance",
      ),
    ).toEqual([String, PerformanceReportDto]);
  });

  it("checks the report entitlement and returns a PowerPoint download", async () => {
    const { controller, reports, billing } = setup();
    const reply = {
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await controller.performancePptx("workspace-a", input, reply as never);

    expect(billing.requireFeature).toHaveBeenCalledWith(
      "workspace-a",
      "reports",
    );
    expect(reports.performancePptx).toHaveBeenCalledWith("workspace-a", input);
    expect(reply.header).toHaveBeenCalledWith(
      "content-type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(reply.header).toHaveBeenCalledWith(
      "content-disposition",
      "attachment; filename=holymedia-performance-report.pptx",
    );
  });
});
