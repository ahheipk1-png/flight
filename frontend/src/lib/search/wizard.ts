// Pure state shape, defaults, step sequencing, validation, and request-
// body construction for the search wizard -- deliberately framework-free
// (no React) so it's unit-testable without rendering anything, and so
// SearchWizard.tsx and useSearchWizard.ts stay thin.

import type { MessageKey } from "@/lib/i18n/messages";
import type {
  DestinationSelection,
  MultiCitySearchRequestBody,
  PlaceSelection,
  SearchRequestBody,
  SearchSubmission,
  TravelClass,
  TripType,
} from "@/lib/types";

export type StepId = "tripType" | "from" | "to" | "when" | "who" | "budget" | "review";

export function stepsFor(tripType: TripType): StepId[] {
  const base: StepId[] = ["tripType", "from", "to"];
  if (tripType !== "multi_city") base.push("when"); // multi-city's dates are inline in the "to" leg editor
  return [...base, "who", "budget", "review"];
}

export interface LegDraft {
  destination: PlaceSelection | null;
  date: string;
}

export interface WizardDraft {
  step: StepId;
  tripType: TripType;

  origin: PlaceSelection | null;

  knowWhere: boolean;
  destinationMode: "regions" | "cities";
  regions: string[];
  destinationCities: PlaceSelection[];

  legs: LegDraft[];

  knowWhen: boolean;
  exactDepartureDate: string;
  exactTripLength: number;
  departureFrom: string;
  departureTo: string;
  specificRange: boolean;
  tripLengthMin: number;
  tripLengthMax: number;

  adults: number;
  children: number;
  infantsInSeat: number;
  infantsOnLap: number;
  travelClass: TravelClass;

  budgetMode: "limit" | "any";
  maxTotal: number;

  maxStops: number;
  minNormalMinutes: number;
  maxNormalMinutes: number;
}

// A large-but-finite sentinel rather than Infinity, so it serializes
// normally and the engine's existing "price > max_total" filter just
// never actually excludes anything -- no engine change needed for "no
// limit" to work.
export const NO_BUDGET_LIMIT = 50000;
export const MIN_LEGS = 2;
export const MAX_LEGS = 6;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

export function defaultDraft(): WizardDraft {
  const from = isoDaysFromNow(21);
  return {
    step: "tripType",
    tripType: "round_trip",

    origin: null,

    knowWhere: true,
    destinationMode: "regions",
    regions: [],
    destinationCities: [],

    legs: [
      { destination: null, date: from },
      { destination: null, date: addDaysIso(from, 7) },
    ],

    knowWhen: false,
    exactDepartureDate: from,
    exactTripLength: 14,
    departureFrom: from,
    departureTo: isoDaysFromNow(90),
    specificRange: false,
    tripLengthMin: 1,
    tripLengthMax: 16,

    adults: 1,
    children: 0,
    infantsInSeat: 0,
    infantsOnLap: 0,
    travelClass: 1,

    budgetMode: "limit",
    maxTotal: 1200,

    maxStops: 1,
    minNormalMinutes: 120,
    maxNormalMinutes: 300,
  };
}

export interface StepError {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** Whether the current step's own fields are complete enough to move on
 * -- cross-step checks (date ordering across steps, etc.) happen in
 * buildSubmission instead, at Review/submit time. */
export function validateStep(draft: WizardDraft): StepError | null {
  switch (draft.step) {
    case "tripType":
      return null;

    case "from":
      return draft.origin ? null : { key: "wizard.errors.noOrigin" };

    case "to":
      if (draft.tripType === "multi_city") {
        if (draft.legs.some((leg) => !leg.destination)) {
          return { key: "form.multiCity.errors.missingDestination" };
        }
        const dates = draft.legs.map((leg) => leg.date);
        const increasing = dates.every((date, i) => i === 0 || date > dates[i - 1]);
        return increasing ? null : { key: "form.multiCity.errors.dateOrder" };
      }
      if (!draft.knowWhere) return null;
      if (draft.destinationMode === "regions") {
        return draft.regions.length > 0 ? null : { key: "form.errors.noRegion" };
      }
      return draft.destinationCities.length > 0 ? null : { key: "wizard.errors.noDestinationCity" };

    case "when": {
      if (draft.knowWhen) return draft.exactDepartureDate ? null : { key: "wizard.errors.noDepartureDate" };
      if (draft.departureTo < draft.departureFrom) return { key: "form.errors.dateOrder" };
      if (draft.tripType !== "one_way" && draft.specificRange && draft.tripLengthMax < draft.tripLengthMin) {
        return { key: "form.errors.tripLengthOrder" };
      }
      return null;
    }

    case "who":
      return draft.adults >= 1 ? null : { key: "wizard.errors.needAdult" };

    case "budget":
      if (draft.budgetMode === "limit" && draft.maxTotal < 1) return { key: "wizard.errors.needBudget" };
      return null;

    case "review":
      return draft.maxNormalMinutes < draft.minNormalMinutes ? { key: "form.errors.layoverOrder" } : null;
  }
}

function resolveDestinations(draft: WizardDraft): DestinationSelection[] {
  if (!draft.knowWhere) return []; // caller expands "anywhere" against the full curated region list
  if (draft.destinationMode === "regions") {
    return draft.regions.map((code) => ({ kind: "region", code, label: code }));
  }
  return draft.destinationCities.map((c) => ({ kind: "city", ...c }));
}

/** Builds the engine request body, or returns the first failing step's
 * error if something upstream was left inconsistent (defensive backstop
 * -- validateStep should already have caught it during navigation). */
export function buildSubmission(
  draft: WizardDraft,
  opts: { anywhereRegionCodes: string[] },
): { ok: true; submission: SearchSubmission } | { ok: false; error: StepError } {
  for (const step of stepsFor(draft.tripType)) {
    const err = validateStep({ ...draft, step });
    if (err) return { ok: false, error: err };
  }

  const passengers = { adults: draft.adults, children: draft.children, infants_in_seat: draft.infantsInSeat, infants_on_lap: draft.infantsOnLap };
  const budget = { currency: "CAD", max_total: draft.budgetMode === "any" ? NO_BUDGET_LIMIT : draft.maxTotal };
  const connections = { max_stops: draft.maxStops, min_normal_minutes: draft.minNormalMinutes, max_normal_minutes: draft.maxNormalMinutes };

  if (draft.tripType === "multi_city") {
    if (!draft.origin) return { ok: false, error: { key: "wizard.errors.noOrigin" } };
    const body: MultiCitySearchRequestBody = {
      origin: draft.origin,
      legs: draft.legs.map((leg) => ({ destination: leg.destination as PlaceSelection, date: leg.date })),
      budget,
      connections,
      passengers,
      travel_class: draft.travelClass,
    };
    return { ok: true, submission: { tripType: "multi_city", body } };
  }

  if (!draft.origin) return { ok: false, error: { key: "wizard.errors.noOrigin" } };

  const isOneWay = draft.tripType === "one_way";
  const windowDays = daysBetween(draft.departureFrom, draft.departureTo);
  const selections = draft.knowWhere
    ? resolveDestinations(draft)
    : opts.anywhereRegionCodes.map((code): DestinationSelection => ({ kind: "region", code, label: code }));

  const effectiveDepartureFrom = draft.knowWhen ? draft.exactDepartureDate : draft.departureFrom;
  const effectiveDepartureTo = draft.knowWhen ? draft.exactDepartureDate : draft.departureTo;
  const tripMin = isOneWay ? 0 : draft.knowWhen ? draft.exactTripLength : draft.specificRange ? draft.tripLengthMin : windowDays;
  const tripMax = isOneWay ? 0 : draft.knowWhen ? draft.exactTripLength : draft.specificRange ? draft.tripLengthMax : windowDays;

  const body: SearchRequestBody = {
    origin: draft.origin,
    destination: { selections },
    dates: {
      departure_from: effectiveDepartureFrom,
      departure_to: effectiveDepartureTo,
      trip_length_min: tripMin,
      trip_length_max: tripMax,
    },
    budget,
    connections,
    passengers,
    travel_class: draft.travelClass,
    trip_type: isOneWay ? "one_way" : "round_trip",
  };
  return { ok: true, submission: { tripType: isOneWay ? "one_way" : "round_trip", body } };
}
