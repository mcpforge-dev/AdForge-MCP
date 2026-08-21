import { describe, expect, it, vi } from "vitest";
import { SiteAnalysisService } from "./site-analysis.service.js";

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
