import { describe, expect, it } from "vitest";
import { summarizeLighthouseMeasurement } from "./site-audit.job.js";

const audits = {
  "first-contentful-paint": { numericValue: 6152.686 },
  "largest-contentful-paint": { numericValue: 8460.186 },
  "total-blocking-time": { numericValue: 7471.5 },
  "cumulative-layout-shift": { numericValue: 0 },
  "speed-index": { numericValue: 11861.2405 },
};

describe("Lighthouse performance measurement semantics", () => {
  it("keeps a valid mobile measurement, including real zero CLS", () => {
    const result = summarizeLighthouseMeasurement({
      lhr: { categories: { performance: { score: 0.26 } }, audits },
    });
    expect(result.state).toBe("valid");
    expect(result.score).toBe(0.26);
    expect(result.readings["cumulative-layout-shift"]).toBe(0);
  });

  it("treats NO_FCP as a failed measurement rather than score zero", () => {
    const result = summarizeLighthouseMeasurement({
      lhr: {
        runtimeError: { code: "NO_FCP" },
        categories: { performance: { score: null } },
        audits: {},
      },
    });
    expect(result.state).toBe("measurement_failed");
    expect(result.score).toBeNull();
  });

  it("treats other Lighthouse runtime errors as failed measurements", () => {
    expect(
      summarizeLighthouseMeasurement({
        lhr: { runtimeError: { code: "PROTOCOL_TIMEOUT" }, audits },
      }).state,
    ).toBe("measurement_failed");
  });

  it("treats an absent report after a timeout or crash as measurement_failed", () => {
    expect(summarizeLighthouseMeasurement(undefined).state).toBe(
      "measurement_failed",
    );
  });

  it("preserves a real calculated score of zero", () => {
    const result = summarizeLighthouseMeasurement({
      lhr: { categories: { performance: { score: 0 } }, audits },
    });
    expect(result.state).toBe("valid");
    expect(result.score).toBe(0);
  });

  it("marks incomplete reports as partial without converting them to failure or zero", () => {
    const result = summarizeLighthouseMeasurement({
      lhr: {
        categories: { performance: { score: 0.48 } },
        audits: {
          ...audits,
          "speed-index": { numericValue: null },
        },
      },
    });
    expect(result.state).toBe("partial");
    expect(result.score).toBe(0.48);
  });
});
