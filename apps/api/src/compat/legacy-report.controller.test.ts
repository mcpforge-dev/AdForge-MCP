import { describe, expect, it, vi } from "vitest";
import { LegacyReportController } from "./legacy-report.controller.js";

const principal = { userId: "user-a" } as never;
const input = {
  account_id: "account-a",
  start_date: "2026-01-01",
  end_date: "2026-01-07",
};

function setup() {
  const reports = {
    performance: vi.fn(async () => ({ reportType: "performance" })),
    performanceDocx: vi.fn(async () => Buffer.from("PK")),
  };
  const workspaces = {
    listForUser: vi.fn(async () => [{ id: "workspace-a" }]),
  };
  const billing = {
    requireFeature: vi.fn(async () => undefined),
  };
  return {
    controller: new LegacyReportController(
      reports as never,
      workspaces as never,
      billing as never,
    ),
    reports,
    billing,
  };
}

describe("legacy report compatibility routes", () => {
  it("checks report entitlement before returning JSON", async () => {
    const { controller, reports, billing } = setup();

    await controller.report(principal, input);

    expect(billing.requireFeature).toHaveBeenCalledWith(
      "workspace-a",
      "reports",
    );
    expect(reports.performance).toHaveBeenCalledOnce();
  });

  it("checks report entitlement before creating a DOCX", async () => {
    const { controller, reports, billing } = setup();

    const reply = {
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as never;
    await controller.reportDocx(principal, input, reply);

    expect(billing.requireFeature).toHaveBeenCalledWith(
      "workspace-a",
      "reports",
    );
    expect(reports.performanceDocx).toHaveBeenCalledOnce();
  });
});
