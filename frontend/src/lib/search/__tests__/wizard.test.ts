// Pure state/validation/request-building tests -- no React, no rendering.

import { describe, expect, it } from "vitest";
import { buildSubmission, defaultDraft, stepsFor, validateStep, type WizardDraft } from "../wizard";

const TOKYO = { airports: ["HND", "NRT"], label: "Tokyo (HND, NRT)" };
const TORONTO = { airports: ["YYZ", "YTZ"], label: "Toronto (YYZ, YTZ)" };

function draft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return { ...defaultDraft(), ...overrides };
}

describe("stepsFor", () => {
  it("includes a When step for round trip/one-way", () => {
    expect(stepsFor("round_trip")).toContain("when");
    expect(stepsFor("one_way")).toContain("when");
  });

  it("skips When for multi-city -- dates are inline in the leg editor", () => {
    expect(stepsFor("multi_city")).not.toContain("when");
  });

  it("always starts with tripType and ends with review", () => {
    for (const t of ["round_trip", "one_way", "multi_city"] as const) {
      const steps = stepsFor(t);
      expect(steps[0]).toBe("tripType");
      expect(steps[steps.length - 1]).toBe("review");
    }
  });
});

describe("validateStep", () => {
  it("blocks leaving From without an origin", () => {
    expect(validateStep(draft({ step: "from", origin: null }))?.key).toBe("wizard.errors.noOrigin");
    expect(validateStep(draft({ step: "from", origin: TORONTO }))).toBeNull();
  });

  it("requires at least one region when knowWhere + region mode", () => {
    const d = draft({ step: "to", knowWhere: true, destinationMode: "regions", regions: [] });
    expect(validateStep(d)?.key).toBe("form.errors.noRegion");
    expect(validateStep({ ...d, regions: ["japan"] })).toBeNull();
  });

  it("requires at least one city when knowWhere + city mode", () => {
    const d = draft({ step: "to", knowWhere: true, destinationMode: "cities", destinationCities: [] });
    expect(validateStep(d)?.key).toBe("wizard.errors.noDestinationCity");
    expect(validateStep({ ...d, destinationCities: [TOKYO] })).toBeNull();
  });

  it("does not require a destination pick when 'anywhere' is chosen", () => {
    expect(validateStep(draft({ step: "to", knowWhere: false }))).toBeNull();
  });

  it("requires every multi-city leg to have a destination", () => {
    const d = draft({
      tripType: "multi_city",
      step: "to",
      legs: [
        { destination: TOKYO, date: "2026-09-10" },
        { destination: null, date: "2026-09-17" },
      ],
    });
    expect(validateStep(d)?.key).toBe("form.multiCity.errors.missingDestination");
  });

  it("requires strictly increasing multi-city leg dates", () => {
    const d = draft({
      tripType: "multi_city",
      step: "to",
      legs: [
        { destination: TOKYO, date: "2026-09-17" },
        { destination: TORONTO, date: "2026-09-10" },
      ],
    });
    expect(validateStep(d)?.key).toBe("form.multiCity.errors.dateOrder");
  });

  it("rejects a departure window end before its start", () => {
    const d = draft({ step: "when", knowWhen: false, departureFrom: "2026-09-20", departureTo: "2026-09-01" });
    expect(validateStep(d)?.key).toBe("form.errors.dateOrder");
  });

  it("rejects max trip length below the minimum", () => {
    const d = draft({ step: "when", knowWhen: false, specificRange: true, tripLengthMin: 20, tripLengthMax: 5 });
    expect(validateStep(d)?.key).toBe("form.errors.tripLengthOrder");
  });

  it("requires at least one adult", () => {
    expect(validateStep(draft({ step: "who", adults: 0 }))?.key).toBe("wizard.errors.needAdult");
  });

  it("requires a positive budget when a limit is set", () => {
    expect(validateStep(draft({ step: "budget", budgetMode: "limit", maxTotal: 0 }))?.key).toBe("wizard.errors.needBudget");
    expect(validateStep(draft({ step: "budget", budgetMode: "any", maxTotal: 0 }))).toBeNull();
  });

  it("rejects an inverted layover window at review", () => {
    expect(validateStep(draft({ step: "review", minNormalMinutes: 300, maxNormalMinutes: 100 }))?.key).toBe("form.errors.layoverOrder");
  });
});

describe("buildSubmission", () => {
  it("builds a round-trip body with the picked origin and region destinations", () => {
    const d = draft({ origin: TORONTO, knowWhere: true, destinationMode: "regions", regions: ["japan"] });
    const result = buildSubmission(d, { anywhereRegionCodes: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.submission.tripType).toBe("round_trip");
    const body = result.submission.body as import("@/lib/types").SearchRequestBody;
    expect(body.origin).toEqual(TORONTO);
    expect(body.destination.selections).toEqual([{ kind: "region", code: "japan", label: "japan" }]);
    expect(body.passengers.adults).toBe(1);
  });

  it("expands 'anywhere' into every curated region", () => {
    const d = draft({ origin: TORONTO, knowWhere: false });
    const result = buildSubmission(d, { anywhereRegionCodes: ["japan", "france"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.submission.body as import("@/lib/types").SearchRequestBody;
    expect(body.destination.selections.map((s) => (s as { code: string }).code)).toEqual(["japan", "france"]);
  });

  it("uses NO_BUDGET_LIMIT as a finite sentinel when budgetMode is 'any'", () => {
    const d = draft({ origin: TORONTO, regions: ["japan"], budgetMode: "any" });
    const result = buildSubmission(d, { anywhereRegionCodes: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.submission.body as import("@/lib/types").SearchRequestBody;
    expect(Number.isFinite(body.budget.max_total)).toBe(true);
    expect(body.budget.max_total).toBeGreaterThan(10000);
  });

  it("builds a multi-city body carrying the picked origin through every leg", () => {
    const d = draft({
      tripType: "multi_city",
      origin: TORONTO,
      legs: [
        { destination: TOKYO, date: "2026-09-10" },
        { destination: { airports: ["IST"], label: "Istanbul" }, date: "2026-09-17" },
      ],
    });
    const result = buildSubmission(d, { anywhereRegionCodes: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.submission.tripType).toBe("multi_city");
    const body = result.submission.body as import("@/lib/types").MultiCitySearchRequestBody;
    expect(body.origin).toEqual(TORONTO);
    expect(body.legs.map((l) => l.destination.label)).toEqual(["Tokyo (HND, NRT)", "Istanbul"]);
  });

  it("fails with the first validation error rather than building a broken body", () => {
    const result = buildSubmission(draft({ origin: null }), { anywhereRegionCodes: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.key).toBe("wizard.errors.noOrigin");
  });
});
