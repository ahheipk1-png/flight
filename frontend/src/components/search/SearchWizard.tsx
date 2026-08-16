"use client";

// Step-by-step search wizard: one question per screen (From -> To -> When
// -> Who -> Budget -> Review, multi-city skips "When" since its dates are
// inline in the leg editor) instead of one long scrolling form. State is
// owned by useSearchWizard, instantiated in page.tsx so it survives
// "Edit search" instead of resetting.

import { PER_SEARCH_LIVE_CAP } from "@/lib/engine/constants";
import { preloadPlaces } from "@/lib/engine/places";
import { daysBetween, MAX_LEGS, MIN_LEGS, type StepId } from "@/lib/search/wizard";
import type { SearchWizardApi } from "@/hooks/useSearchWizard";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { localizedRegionName } from "@/lib/i18n/placeNames";
import type { MessageKey } from "@/lib/i18n/messages";
import type { MetaResponse, PlaceSelection, SearchSubmission, TripType } from "@/lib/types";
import { PlacePicker, PlaceSlot } from "./PlacePicker";

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none";

const STEP_TITLE: Record<StepId, MessageKey> = {
  tripType: "wizard.step.tripType",
  from: "wizard.step.from",
  to: "wizard.step.to",
  when: "wizard.step.when",
  who: "wizard.step.who",
  budget: "wizard.step.budget",
  review: "wizard.step.review",
};

interface SearchWizardProps {
  api: SearchWizardApi;
  meta: MetaResponse | null;
  metaError: string | null;
  onSubmit: (submission: SearchSubmission) => void;
}

export function SearchWizard({ api, meta, metaError, onSubmit }: SearchWizardProps) {
  const { t } = useLocale();
  const { draft, steps, stepIndex, error, next, back, goTo, submit } = api;

  function handleSubmit() {
    const submission = submit();
    if (submission) onSubmit(submission);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <ProgressBar steps={steps} stepIndex={stepIndex} onJump={(s) => goTo(s)} />

      <div className="mt-8 min-h-[22rem]">
        {draft.step === "tripType" && <TripTypeStep api={api} />}
        {draft.step === "from" && <FromStep api={api} />}
        {draft.step === "to" && <ToStep api={api} meta={meta} metaError={metaError} />}
        {draft.step === "when" && <WhenStep api={api} />}
        {draft.step === "who" && <WhoStep api={api} />}
        {draft.step === "budget" && <BudgetStep api={api} />}
        {draft.step === "review" && <ReviewStep api={api} />}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{t(error.key, error.params)}</p>}

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={stepIndex === 0}
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-0"
        >
          {t("wizard.back")}
        </button>
        {draft.step === "review" ? (
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-full bg-sky-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
          >
            {t("form.submit")}
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            className="rounded-full bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
          >
            {t("wizard.next")}
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ steps, stepIndex, onJump }: { steps: StepId[]; stepIndex: number; onJump: (step: StepId) => void }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => (
        <button
          key={s}
          type="button"
          onClick={() => i < stepIndex && onJump(s)}
          title={t(STEP_TITLE[s])}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i <= stepIndex ? "bg-sky-600" : "bg-slate-200"
          } ${i < stepIndex ? "cursor-pointer" : "cursor-default"}`}
        />
      ))}
    </div>
  );
}

function StepHeading({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold text-slate-900">{children}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}

// --- Step 1: trip type ---

function TripTypeStep({ api }: { api: SearchWizardApi }) {
  const { t } = useLocale();
  const { draft, setTripType } = api;
  const options: { value: TripType; label: MessageKey }[] = [
    { value: "round_trip", label: "form.tripType.roundTrip" },
    { value: "one_way", label: "form.tripType.oneWay" },
    { value: "multi_city", label: "form.tripType.multiCity" },
  ];
  return (
    <div>
      <StepHeading subtitle={t("wizard.step.tripType.subtitle")}>{t("wizard.step.tripType")}</StepHeading>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <ToggleChip key={o.value} active={draft.tripType === o.value} onClick={() => setTripType(o.value)}>
            {t(o.label)}
          </ToggleChip>
        ))}
      </div>
    </div>
  );
}

// --- Step 2: from ---

function FromStep({ api }: { api: SearchWizardApi }) {
  const { t } = useLocale();
  const { draft, patch } = api;
  return (
    <div>
      <StepHeading subtitle={t("wizard.step.from.subtitle")}>{t("wizard.step.from")}</StepHeading>
      <PlaceSlot value={draft.origin} onChange={(origin) => patch({ origin })} placeholder={t("wizard.from.placeholder")} />
    </div>
  );
}

// --- Step 3: to ---

function ToStep({ api, meta, metaError }: { api: SearchWizardApi; meta: MetaResponse | null; metaError: string | null }) {
  const { t, locale } = useLocale();
  const { draft, patch, updateLeg, addLeg, removeLeg } = api;
  const destinationRegions = meta?.travel_regions.filter((r) => r.kind === "destination") ?? [];

  if (draft.tripType === "multi_city") {
    return (
      <div>
        <StepHeading subtitle={t("wizard.step.to.multiCitySubtitle")}>{t("wizard.step.to")}</StepHeading>
        <div className="space-y-4">
          {draft.legs.map((leg, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  {t("form.multiCity.legLabel", { n: idx + 1 })}
                </span>
                {draft.legs.length > MIN_LEGS && (
                  <button type="button" onClick={() => removeLeg(idx)} className="text-xs font-medium text-red-600 hover:text-red-700">
                    {t("form.multiCity.removeLeg")}
                  </button>
                )}
              </div>
              <PlaceSlot
                value={leg.destination}
                onChange={(destination) => updateLeg(idx, { destination })}
                placeholder={t("form.multiCity.pickCity")}
              />
              <div className="mt-2">
                <input
                  type="date"
                  value={leg.date}
                  onChange={(e) => updateLeg(idx, { date: e.target.value })}
                  className={INPUT_CLASS}
                  required
                />
              </div>
            </div>
          ))}
          {draft.legs.length < MAX_LEGS && (
            <button type="button" onClick={addLeg} className="text-sm font-medium text-sky-600 hover:text-sky-700">
              {t("form.multiCity.addLeg")}
            </button>
          )}
          <p className="text-xs text-slate-400">{t("form.multiCity.hint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepHeading>{t("wizard.step.to")}</StepHeading>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={draft.knowWhere}
          onChange={(e) => patch({ knowWhere: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        {t("form.where.knowCheckbox")}
      </label>

      {metaError && <p className="mt-2 text-sm text-red-600">{metaError}</p>}

      {!draft.knowWhere ? (
        <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-700 ring-1 ring-sky-200">{t("form.where.anywhereNote")}</p>
      ) : (
        <div className="mt-4">
          <div className="flex gap-2">
            <ToggleChip active={draft.destinationMode === "regions"} onClick={() => patch({ destinationMode: "regions" })}>
              {t("wizard.to.regionMode")}
            </ToggleChip>
            <ToggleChip active={draft.destinationMode === "cities"} onClick={() => patch({ destinationMode: "cities" })}>
              {t("wizard.to.cityMode")}
            </ToggleChip>
          </div>

          {draft.destinationMode === "regions" ? (
            destinationRegions.length > 0 ? (
              <>
                <select
                  multiple
                  value={draft.regions}
                  onChange={(e) => patch({ regions: Array.from(e.target.selectedOptions).map((o) => o.value) })}
                  size={Math.min(destinationRegions.length, 8)}
                  className={`mt-3 ${INPUT_CLASS}`}
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
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap gap-2">
                {draft.destinationCities.map((c) => (
                  <span
                    key={c.label}
                    className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700 ring-1 ring-sky-200"
                  >
                    {c.label}
                    <button
                      type="button"
                      onClick={() => patch({ destinationCities: draft.destinationCities.filter((x) => x.label !== c.label) })}
                      className="text-sky-400 hover:text-sky-600"
                      aria-label={t("wizard.to.removeCity", { city: c.label })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <PlacePicker
                placeholder={t("wizard.to.cityPlaceholder")}
                excludeAirports={draft.destinationCities.flatMap((c) => c.airports)}
                onSelect={(selection: PlaceSelection) => patch({ destinationCities: [...draft.destinationCities, selection] })}
              />
              <p className="mt-1 text-xs text-slate-400">{t("wizard.to.cityHint")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Step 4: when (not shown for multi-city) ---

function WhenStep({ api }: { api: SearchWizardApi }) {
  const { t } = useLocale();
  const { draft, patch } = api;
  const isOneWay = draft.tripType === "one_way";
  const windowDays = daysBetween(draft.departureFrom, draft.departureTo);

  function toggleSpecificRange(checked: boolean) {
    patch(checked ? { specificRange: true, tripLengthMin: 1, tripLengthMax: windowDays } : { specificRange: false });
  }

  const description = isOneWay
    ? draft.knowWhen
      ? t("form.when.oneWayExactDesc", { date: draft.exactDepartureDate })
      : t("form.when.oneWayFixedDesc")
    : draft.knowWhen
      ? t("form.when.exactDesc", { days: draft.exactTripLength, date: draft.exactDepartureDate })
      : draft.specificRange
        ? t("form.when.rangeDesc", { min: draft.tripLengthMin, max: draft.tripLengthMax })
        : t("form.when.fixedDesc", { days: windowDays });

  return (
    <div>
      <StepHeading subtitle={description}>{t("wizard.step.when")}</StepHeading>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={draft.knowWhen}
          onChange={(e) => patch({ knowWhen: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
        {t("form.when.knowCheckbox")}
      </label>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {draft.knowWhen ? (
          <>
            <LabeledInput label={t("form.when.exactDepartureLabel")}>
              <input
                type="date"
                value={draft.exactDepartureDate}
                onChange={(e) => patch({ exactDepartureDate: e.target.value })}
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
                  value={draft.exactTripLength}
                  onChange={(e) => patch({ exactTripLength: Number(e.target.value) })}
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
                value={draft.departureFrom}
                onChange={(e) => patch({ departureFrom: e.target.value })}
                className={INPUT_CLASS}
                required
              />
            </LabeledInput>
            <LabeledInput label={t("form.when.latest")}>
              <input
                type="date"
                value={draft.departureTo}
                onChange={(e) => patch({ departureTo: e.target.value })}
                className={INPUT_CLASS}
                required
              />
            </LabeledInput>
            {!isOneWay && (
              <>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={draft.specificRange}
                      onChange={(e) => toggleSpecificRange(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    {t("form.when.specificRange")}
                  </label>
                </div>
                {draft.specificRange && (
                  <>
                    <LabeledInput label={t("form.when.shortest")}>
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={draft.tripLengthMin}
                        onChange={(e) => patch({ tripLengthMin: Number(e.target.value) })}
                        className={INPUT_CLASS}
                      />
                    </LabeledInput>
                    <LabeledInput label={t("form.when.longest")}>
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={draft.tripLengthMax}
                        onChange={(e) => patch({ tripLengthMax: Number(e.target.value) })}
                        className={INPUT_CLASS}
                      />
                    </LabeledInput>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Step 5: who ---

function StepperInput({ label, hint, value, min = 0, max = 9, onChange }: { label: string; hint?: string; value: number; min?: number; max?: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
          disabled={value <= min}
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-semibold text-slate-800">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}

function WhoStep({ api }: { api: SearchWizardApi }) {
  const { t } = useLocale();
  const { draft, patch } = api;
  const cabins: { value: 1 | 2 | 3 | 4; label: MessageKey }[] = [
    { value: 1, label: "wizard.cabin.economy" },
    { value: 2, label: "wizard.cabin.premium" },
    { value: 3, label: "wizard.cabin.business" },
    { value: 4, label: "wizard.cabin.first" },
  ];
  return (
    <div>
      <StepHeading subtitle={t("wizard.step.who.subtitle")}>{t("wizard.step.who")}</StepHeading>
      <div className="space-y-2">
        <StepperInput label={t("wizard.who.adults")} value={draft.adults} min={1} onChange={(adults) => patch({ adults })} />
        <StepperInput
          label={t("wizard.who.children")}
          hint={t("wizard.who.childrenHint")}
          value={draft.children}
          onChange={(children) => patch({ children })}
        />
        <StepperInput
          label={t("wizard.who.infantsInSeat")}
          hint={t("wizard.who.infantsInSeatHint")}
          value={draft.infantsInSeat}
          onChange={(infantsInSeat) => patch({ infantsInSeat })}
        />
        <StepperInput
          label={t("wizard.who.infantsOnLap")}
          hint={t("wizard.who.infantsOnLapHint")}
          value={draft.infantsOnLap}
          onChange={(infantsOnLap) => patch({ infantsOnLap })}
        />
      </div>

      <p className="mt-6 mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">{t("wizard.who.cabin")}</p>
      <div className="flex flex-wrap gap-2">
        {cabins.map((c) => (
          <ToggleChip key={c.value} active={draft.travelClass === c.value} onClick={() => patch({ travelClass: c.value })}>
            {t(c.label)}
          </ToggleChip>
        ))}
      </div>
    </div>
  );
}

// --- Step 6: budget ---

function BudgetStep({ api }: { api: SearchWizardApi }) {
  const { t } = useLocale();
  const { draft, patch } = api;
  return (
    <div>
      <StepHeading subtitle={t("wizard.step.budget.subtitle")}>{t("wizard.step.budget")}</StepHeading>
      <div className="flex gap-2">
        <ToggleChip active={draft.budgetMode === "limit"} onClick={() => patch({ budgetMode: "limit" })}>
          {t("form.budget.setLimit")}
        </ToggleChip>
        <ToggleChip active={draft.budgetMode === "any"} onClick={() => patch({ budgetMode: "any" })}>
          {t("form.budget.noLimit")}
        </ToggleChip>
      </div>
      {draft.budgetMode === "limit" && (
        <div className="mt-4">
          <LabeledInput label={t("form.budget.maxTotal")}>
            <input
              type="number"
              min={1}
              value={draft.maxTotal}
              onChange={(e) => patch({ maxTotal: Number(e.target.value) })}
              className={INPUT_CLASS}
            />
          </LabeledInput>
        </div>
      )}
    </div>
  );
}

// --- Step 7: review ---

function ReviewStep({ api }: { api: SearchWizardApi }) {
  const { t, locale } = useLocale();
  const { draft, patch } = api;

  const originLabel = draft.origin?.label ?? "";
  const destinationLabel =
    draft.tripType === "multi_city"
      ? draft.legs.map((l) => l.destination?.label).filter(Boolean).join(" → ")
      : !draft.knowWhere
        ? t("form.where.anywhereNote")
        : draft.destinationMode === "regions"
          ? draft.regions.map((code) => localizedRegionName(code, code, locale)).join(", ")
          : draft.destinationCities.map((c) => c.label).join(", ");

  const passengerSummary = [
    t("wizard.who.adults") + " × " + draft.adults,
    draft.children > 0 ? t("wizard.who.children") + " × " + draft.children : null,
    draft.infantsInSeat > 0 ? t("wizard.who.infantsInSeat") + " × " + draft.infantsInSeat : null,
    draft.infantsOnLap > 0 ? t("wizard.who.infantsOnLap") + " × " + draft.infantsOnLap : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div>
      <StepHeading>{t("wizard.step.review")}</StepHeading>

      <dl className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm">
        <ReviewRow label={t("wizard.step.from")} value={originLabel} />
        <ReviewRow label={t("wizard.step.to")} value={destinationLabel} />
        <ReviewRow label={t("wizard.step.who")} value={passengerSummary} />
      </dl>

      <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700 ring-1 ring-sky-200">
        {draft.tripType === "multi_city"
          ? t("wizard.review.multiCityCallCount", { n: draft.legs.length })
          : t("wizard.review.callCount", { n: PER_SEARCH_LIVE_CAP })}
      </p>

      <details className="mt-6 rounded-xl border border-slate-200 p-4" onToggle={() => preloadPlaces()}>
        <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-400 uppercase">
          {t("wizard.review.advanced")}
        </summary>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <LabeledInput label={t("form.layover.maxStops")}>
            <input
              type="number"
              min={0}
              max={2}
              value={draft.maxStops}
              onChange={(e) => patch({ maxStops: Number(e.target.value) })}
              className={INPUT_CLASS}
            />
          </LabeledInput>
          <div />
          <LabeledInput label={t("form.layover.minNormal")}>
            <input
              type="number"
              min={0}
              value={draft.minNormalMinutes}
              onChange={(e) => patch({ minNormalMinutes: Number(e.target.value) })}
              className={INPUT_CLASS}
            />
          </LabeledInput>
          <LabeledInput label={t("form.layover.maxNormal")}>
            <input
              type="number"
              min={0}
              value={draft.maxNormalMinutes}
              onChange={(e) => patch({ maxNormalMinutes: Number(e.target.value) })}
              className={INPUT_CLASS}
            />
          </LabeledInput>
        </div>
      </details>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs font-semibold tracking-wide text-slate-400 uppercase">{label}</dt>
      <dd className="text-right text-slate-700">{value || "—"}</dd>
    </div>
  );
}
