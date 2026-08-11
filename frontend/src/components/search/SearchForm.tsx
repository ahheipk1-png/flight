"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { localizedCityName, localizedRegionName } from "@/lib/i18n/placeNames";
import type { MetaResponse, MultiCitySearchRequestBody, SearchRequestBody, SearchSubmission, TripType } from "@/lib/types";

interface SearchFormProps {
  meta: MetaResponse | null;
  metaError: string | null;
  onSubmit: (submission: SearchSubmission) => void;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none";

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

// A large-but-finite sentinel rather than Infinity, so it serializes
// normally and the backend's existing "price > max_total" filter
// (search/verification.py) just never actually excludes anything -- no
// backend change needed for "no limit" to work.
const NO_BUDGET_LIMIT = 50000;

function defaultDates() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() + 21);
  const to = new Date(today);
  to.setDate(to.getDate() + 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const MIN_LEGS = 2;
const MAX_LEGS = 6;

interface LegDraft {
  destination: string;
  date: string;
}

export function SearchForm({ meta, metaError, onSubmit }: SearchFormProps) {
  const { t, locale } = useLocale();

  // "I know where" (default true -- today's droplist, unchanged). Off:
  // skip picking anything, search every supported destination at once
  // (spec's "Anywhere for My Budget") -- purely a frontend auto-select of
  // every region code; the backend already accepts a region-code list of
  // any size, so no backend change is needed for this either.
  const [knowWhere, setKnowWhere] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);

  // Trip type only matters -- and is only shown -- while knowWhere is
  // true (per the original ask: "round trip, single or multi city for I
  // know where"). "Anywhere" search stays round-trip-only, unchanged.
  const [tripType, setTripType] = useState<TripType>("round_trip");
  const effectiveTripType: TripType = knowWhere ? tripType : "round_trip";
  const isOneWay = effectiveTripType === "one_way";
  const isMultiCity = effectiveTripType === "multi_city";

  // "I know exactly when" (default false -- today's flexible window,
  // unchanged). On: one exact departure date + one exact trip length,
  // submitted as a single-day window with trip_length_min == max -- a
  // pinpoint case of the existing flexible search parameters, same
  // sentinel-value pattern as originMode/budgetMode below, so this also
  // needs no backend change.
  const [knowWhen, setKnowWhen] = useState(false);
  const { from: defaultFrom, to: defaultTo } = useMemo(() => defaultDates(), []);
  const [exactDepartureDate, setExactDepartureDate] = useState(defaultFrom);
  const [exactTripLength, setExactTripLength] = useState(14);
  const [departureFrom, setDepartureFrom] = useState(defaultFrom);
  const [departureTo, setDepartureTo] = useState(defaultTo);
  // Unchecked (the default): trip length isn't a separate choice at all --
  // it's just however many days sit between the two departure-window
  // dates, recomputed live, not editable. Checked: min/max become
  // independent editable fields, seeded from that same computed value.
  const [specificRange, setSpecificRange] = useState(false);
  const [tripLengthMin, setTripLengthMin] = useState(1);
  const [tripLengthMax, setTripLengthMax] = useState(16);

  const [legs, setLegs] = useState<LegDraft[]>([
    { destination: "", date: defaultFrom },
    { destination: "", date: addDays(defaultFrom, 7) },
  ]);

  const [budgetMode, setBudgetMode] = useState<"limit" | "any">("limit");
  const [maxTotal, setMaxTotal] = useState(1200);
  const [originMode, setOriginMode] = useState<"same" | "nearby">("nearby");
  const [maxGroundMinutes, setMaxGroundMinutes] = useState(120);
  const [minSavingPerPerson, setMinSavingPerPerson] = useState(100);
  const [maxStops, setMaxStops] = useState(1);
  const [minNormalMinutes, setMinNormalMinutes] = useState(120);
  const [maxNormalMinutes, setMaxNormalMinutes] = useState(300);
  const [formError, setFormError] = useState<string | null>(null);

  const destinationRegions = meta?.travel_regions.filter((r) => r.kind === "destination") ?? [];
  const originAirports = meta?.airports.filter((a) => meta.origin_group.includes(a.iata)) ?? [];
  // Multi-city legs pick a specific city, not a region -- reuse the same
  // airport catalog the map/results already know about rather than
  // introducing a second destination list.
  const legAirportOptions = useMemo(
    () => (meta?.airports.filter((a) => !meta.origin_group.includes(a.iata)) ?? []).sort((a, b) => a.city.localeCompare(b.city)),
    [meta],
  );
  const windowDays = daysBetween(departureFrom, departureTo);

  function toggleSpecificRange(checked: boolean) {
    if (checked) {
      // Seed the editable fields from the derived value at the moment of
      // checking -- after this they're normal independent state, not
      // continuously recomputed from the dates.
      setTripLengthMin(1);
      setTripLengthMax(windowDays);
    }
    setSpecificRange(checked);
  }

  function updateLeg(index: number, patch: Partial<LegDraft>) {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  function addLeg() {
    setLegs((prev) => (prev.length >= MAX_LEGS ? prev : [...prev, { destination: "", date: addDays(prev[prev.length - 1].date, 7) }]));
  }

  function removeLeg(index: number) {
    setLegs((prev) => (prev.length <= MIN_LEGS ? prev : prev.filter((_, i) => i !== index)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isMultiCity) {
      if (legs.some((leg) => !leg.destination)) {
        setFormError(t("form.multiCity.errors.missingDestination"));
        return;
      }
      const dates = legs.map((leg) => leg.date);
      const strictlyIncreasing = dates.every((date, i) => i === 0 || date > dates[i - 1]);
      if (!strictlyIncreasing) {
        setFormError(t("form.multiCity.errors.dateOrder"));
        return;
      }
      if (maxNormalMinutes < minNormalMinutes) {
        setFormError(t("form.errors.layoverOrder"));
        return;
      }
      setFormError(null);

      const body: MultiCitySearchRequestBody = {
        legs: legs.map((leg) => ({ destination: leg.destination, date: leg.date })),
        budget: { currency: "CAD", max_total: budgetMode === "any" ? NO_BUDGET_LIMIT : maxTotal },
        connections: { max_stops: maxStops, min_normal_minutes: minNormalMinutes, max_normal_minutes: maxNormalMinutes },
        adults: 1,
      };
      onSubmit({ tripType: "multi_city", body });
      return;
    }

    const effectiveRegions = knowWhere ? regions : destinationRegions.map((r) => r.code);
    const effectiveDepartureFrom = knowWhen ? exactDepartureDate : departureFrom;
    const effectiveDepartureTo = knowWhen ? exactDepartureDate : departureTo;
    const effectiveTripMin = isOneWay ? 0 : knowWhen ? exactTripLength : specificRange ? tripLengthMin : windowDays;
    const effectiveTripMax = isOneWay ? 0 : knowWhen ? exactTripLength : specificRange ? tripLengthMax : windowDays;
    const effectiveMaxTotal = budgetMode === "any" ? NO_BUDGET_LIMIT : maxTotal;

    if (effectiveRegions.length === 0) {
      setFormError(t("form.errors.noRegion"));
      return;
    }
    if (!knowWhen && effectiveDepartureTo < effectiveDepartureFrom) {
      setFormError(t("form.errors.dateOrder"));
      return;
    }
    if (effectiveTripMax < effectiveTripMin) {
      setFormError(t("form.errors.tripLengthOrder"));
      return;
    }
    if (maxNormalMinutes < minNormalMinutes) {
      setFormError(t("form.errors.layoverOrder"));
      return;
    }
    setFormError(null);

    const body: SearchRequestBody = {
      origin: {
        region: "greater_toronto",
        // "same" -> 0: every alternate airport's ground time is > 0, so
        // the backend's existing "drop alternates over max_ground_minutes"
        // rule already excludes all of them -- no backend change needed.
        max_ground_minutes: originMode === "same" ? 0 : maxGroundMinutes,
        min_saving_per_person: minSavingPerPerson,
      },
      destination: { regions: effectiveRegions },
      dates: {
        departure_from: effectiveDepartureFrom,
        departure_to: effectiveDepartureTo,
        trip_length_min: effectiveTripMin,
        trip_length_max: effectiveTripMax,
      },
      budget: { currency: "CAD", max_total: effectiveMaxTotal },
      connections: { max_stops: maxStops, min_normal_minutes: minNormalMinutes, max_normal_minutes: maxNormalMinutes },
      adults: 1,
      trip_type: isOneWay ? "one_way" : "round_trip",
    };
    onSubmit({ tripType: isOneWay ? "one_way" : "round_trip", body });
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-8">
      <section>
        <FieldLabel>{t("form.from.label")}</FieldLabel>
        <p className="text-sm text-slate-500">{t("form.from.subtitle")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {originAirports.length > 0
            ? originAirports.map((a) => (
                <span key={a.iata} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
                  {a.iata}
                </span>
              ))
            : ["YYZ", "YTZ", "YHM", "YKF"].map((iata) => (
                <span key={iata} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
                  {iata}
                </span>
              ))}
        </div>
        {isMultiCity ? (
          <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700 ring-1 ring-sky-200">
            {t("form.from.multiCityNote")}
          </p>
        ) : (
          <>
            <div className="mt-4 flex gap-2">
              <ToggleChip active={originMode === "same"} onClick={() => setOriginMode("same")}>
                {t("form.origin.same")}
              </ToggleChip>
              <ToggleChip active={originMode === "nearby"} onClick={() => setOriginMode("nearby")}>
                {t("form.origin.nearby")}
              </ToggleChip>
            </div>
            {originMode === "nearby" && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <LabeledInput label={t("form.origin.maxGround")}>
                  <input
                    type="number"
                    min={0}
                    value={maxGroundMinutes}
                    onChange={(e) => setMaxGroundMinutes(Number(e.target.value))}
                    className={INPUT_CLASS}
                  />
                </LabeledInput>
                <LabeledInput label={t("form.origin.minSaving")}>
                  <input
                    type="number"
                    min={0}
                    value={minSavingPerPerson}
                    onChange={(e) => setMinSavingPerPerson(Number(e.target.value))}
                    className={INPUT_CLASS}
                  />
                </LabeledInput>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <FieldLabel>{t("form.where.label")}</FieldLabel>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={knowWhere}
            onChange={(e) => setKnowWhere(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          {t("form.where.knowCheckbox")}
        </label>

        {knowWhere && (
          <div className="mt-3 flex gap-2">
            <ToggleChip active={tripType === "round_trip"} onClick={() => setTripType("round_trip")}>
              {t("form.tripType.roundTrip")}
            </ToggleChip>
            <ToggleChip active={tripType === "one_way"} onClick={() => setTripType("one_way")}>
              {t("form.tripType.oneWay")}
            </ToggleChip>
            <ToggleChip active={tripType === "multi_city"} onClick={() => setTripType("multi_city")}>
              {t("form.tripType.multiCity")}
            </ToggleChip>
          </div>
        )}

        {metaError && <p className="mt-2 text-sm text-red-600">{metaError}</p>}

        {isMultiCity ? (
          <div className="mt-4 space-y-3">
            {legs.map((leg, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  <LabeledInput label={t("form.multiCity.legLabel", { n: idx + 1 })}>
                    <select value={leg.destination} onChange={(e) => updateLeg(idx, { destination: e.target.value })} className={INPUT_CLASS}>
                      <option value="">{t("form.multiCity.pickCity")}</option>
                      {legAirportOptions.map((a) => (
                        <option key={a.iata} value={a.iata}>
                          {localizedCityName(a.iata, a.city, locale)} ({a.iata})
                        </option>
                      ))}
                    </select>
                  </LabeledInput>
                </div>
                <div className="w-40 shrink-0">
                  <LabeledInput label={t("form.multiCity.legDate")}>
                    <input type="date" value={leg.date} onChange={(e) => updateLeg(idx, { date: e.target.value })} className={INPUT_CLASS} required />
                  </LabeledInput>
                </div>
                {legs.length > MIN_LEGS && (
                  <button
                    type="button"
                    onClick={() => removeLeg(idx)}
                    className="mb-2 shrink-0 text-sm font-medium text-red-600 hover:text-red-700"
                  >
                    {t("form.multiCity.removeLeg")}
                  </button>
                )}
              </div>
            ))}
            {legs.length < MAX_LEGS && (
              <button type="button" onClick={addLeg} className="text-sm font-medium text-sky-600 hover:text-sky-700">
                {t("form.multiCity.addLeg")}
              </button>
            )}
            <p className="text-xs text-slate-400">{t("form.multiCity.hint")}</p>
          </div>
        ) : knowWhere ? (
          destinationRegions.length > 0 ? (
            <>
              <select
                multiple
                value={regions}
                onChange={(e) => setRegions(Array.from(e.target.selectedOptions).map((o) => o.value))}
                size={Math.min(destinationRegions.length, 8)}
                className={`mt-2 ${INPUT_CLASS}`}
              >
                {destinationRegions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {localizedRegionName(r.code, r.name, locale)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">{t("form.where.hint")}</p>
            </>
          ) : (
            !metaError && <p className="mt-2 text-sm text-slate-400">{t("form.where.loading")}</p>
          )
        ) : (
          <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700 ring-1 ring-sky-200">
            {t("form.where.anywhereNote")}
          </p>
        )}
      </section>

      {!isMultiCity && (
        <section className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <FieldLabel>{t("form.when.label")}</FieldLabel>
            <p className="text-sm text-slate-500">
              {isOneWay
                ? knowWhen
                  ? t("form.when.oneWayExactDesc", { date: exactDepartureDate })
                  : t("form.when.oneWayFixedDesc")
                : knowWhen
                  ? t("form.when.exactDesc", { days: exactTripLength, date: exactDepartureDate })
                  : specificRange
                    ? t("form.when.rangeDesc", { min: tripLengthMin, max: tripLengthMax })
                    : t("form.when.fixedDesc", { days: windowDays })}
            </p>
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={knowWhen}
                onChange={(e) => setKnowWhen(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              {t("form.when.knowCheckbox")}
            </label>
          </div>
          {knowWhen ? (
            <>
              <LabeledInput label={t("form.when.exactDepartureLabel")}>
                <input
                  type="date"
                  value={exactDepartureDate}
                  onChange={(e) => setExactDepartureDate(e.target.value)}
                  className={INPUT_CLASS}
                  required
                />
              </LabeledInput>
              {!isOneWay && (
                <LabeledInput label={t("form.when.exactLengthLabel")}>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={exactTripLength}
                    onChange={(e) => setExactTripLength(Number(e.target.value))}
                    className={INPUT_CLASS}
                  />
                </LabeledInput>
              )}
            </>
          ) : (
            <>
              <LabeledInput label={t("form.when.earliest")}>
                <input
                  type="date"
                  value={departureFrom}
                  onChange={(e) => setDepartureFrom(e.target.value)}
                  className={INPUT_CLASS}
                  required
                />
              </LabeledInput>
              <LabeledInput label={t("form.when.latest")}>
                <input type="date" value={departureTo} onChange={(e) => setDepartureTo(e.target.value)} className={INPUT_CLASS} required />
              </LabeledInput>
              {!isOneWay && (
                <>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={specificRange}
                        onChange={(e) => toggleSpecificRange(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      {t("form.when.specificRange")}
                    </label>
                  </div>
                  {specificRange && (
                    <>
                      <LabeledInput label={t("form.when.shortest")}>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={tripLengthMin}
                          onChange={(e) => setTripLengthMin(Number(e.target.value))}
                          className={INPUT_CLASS}
                        />
                      </LabeledInput>
                      <LabeledInput label={t("form.when.longest")}>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={tripLengthMax}
                          onChange={(e) => setTripLengthMax(Number(e.target.value))}
                          className={INPUT_CLASS}
                        />
                      </LabeledInput>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}

      <section>
        <FieldLabel>{t("form.budget.label")}</FieldLabel>
        <div className="mt-2 flex gap-2">
          <ToggleChip active={budgetMode === "limit"} onClick={() => setBudgetMode("limit")}>
            {t("form.budget.setLimit")}
          </ToggleChip>
          <ToggleChip active={budgetMode === "any"} onClick={() => setBudgetMode("any")}>
            {t("form.budget.noLimit")}
          </ToggleChip>
        </div>
        {budgetMode === "limit" && (
          <div className="mt-4">
            <LabeledInput label={t("form.budget.maxTotal")}>
              <input
                type="number"
                min={1}
                value={maxTotal}
                onChange={(e) => setMaxTotal(Number(e.target.value))}
                className={INPUT_CLASS}
              />
            </LabeledInput>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <FieldLabel>{t("form.layover.label")}</FieldLabel>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <LabeledInput label={t("form.layover.maxStops")}>
            <input type="number" min={0} max={2} value={maxStops} onChange={(e) => setMaxStops(Number(e.target.value))} className={INPUT_CLASS} />
          </LabeledInput>
          <div />
          <LabeledInput label={t("form.layover.minNormal")}>
            <input
              type="number"
              min={0}
              value={minNormalMinutes}
              onChange={(e) => setMinNormalMinutes(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </LabeledInput>
          <LabeledInput label={t("form.layover.maxNormal")}>
            <input
              type="number"
              min={0}
              value={maxNormalMinutes}
              onChange={(e) => setMaxNormalMinutes(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </LabeledInput>
        </div>
      </section>

      {formError && <p className="text-sm text-red-600">{formError}</p>}

      <button
        type="submit"
        className="w-full rounded-full bg-sky-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
      >
        {t("form.submit")}
      </button>
    </form>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{children}</h2>;
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}
