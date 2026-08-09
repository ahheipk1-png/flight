"use client";

import { useMemo, useState } from "react";
import type { MetaResponse, SearchRequestBody } from "@/lib/types";

interface SearchFormProps {
  meta: MetaResponse | null;
  metaError: string | null;
  onSubmit: (body: SearchRequestBody) => void;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none";

function defaultDates() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() + 21);
  const to = new Date(today);
  to.setDate(to.getDate() + 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export function SearchForm({ meta, metaError, onSubmit }: SearchFormProps) {
  const [regions, setRegions] = useState<string[]>([]);
  const { from: defaultFrom, to: defaultTo } = useMemo(() => defaultDates(), []);
  const [departureFrom, setDepartureFrom] = useState(defaultFrom);
  const [departureTo, setDepartureTo] = useState(defaultTo);
  const [tripLengthMin, setTripLengthMin] = useState(10);
  const [tripLengthMax, setTripLengthMax] = useState(16);
  const [maxTotal, setMaxTotal] = useState(1200);
  const [maxGroundMinutes, setMaxGroundMinutes] = useState(120);
  const [minSavingPerPerson, setMinSavingPerPerson] = useState(100);
  const [maxStops, setMaxStops] = useState(1);
  const [minNormalMinutes, setMinNormalMinutes] = useState(120);
  const [maxNormalMinutes, setMaxNormalMinutes] = useState(300);
  const [formError, setFormError] = useState<string | null>(null);

  const destinationRegions = meta?.travel_regions.filter((r) => r.kind === "destination") ?? [];
  const originAirports = meta?.airports.filter((a) => meta.origin_group.includes(a.iata)) ?? [];

  function toggleRegion(code: string) {
    setRegions((prev) => (prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (regions.length === 0) {
      setFormError("Pick at least one destination region.");
      return;
    }
    if (departureTo < departureFrom) {
      setFormError("Your return-window end can't be before its start.");
      return;
    }
    if (tripLengthMax < tripLengthMin) {
      setFormError("Max trip length can't be less than the minimum.");
      return;
    }
    if (maxNormalMinutes < minNormalMinutes) {
      setFormError("Max connection time can't be less than the minimum.");
      return;
    }
    setFormError(null);

    const body: SearchRequestBody = {
      origin: { region: "greater_toronto", max_ground_minutes: maxGroundMinutes, min_saving_per_person: minSavingPerPerson },
      destination: { regions },
      dates: { departure_from: departureFrom, departure_to: departureTo, trip_length_min: tripLengthMin, trip_length_max: tripLengthMax },
      budget: { currency: "CAD", max_total: maxTotal },
      connections: { max_stops: maxStops, min_normal_minutes: minNormalMinutes, max_normal_minutes: maxNormalMinutes },
      adults: 1,
    };
    onSubmit(body);
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-8">
      <section>
        <FieldLabel>From</FieldLabel>
        <p className="text-sm text-slate-500">Toronto region</p>
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
      </section>

      <section>
        <FieldLabel>Where</FieldLabel>
        {metaError && <p className="text-sm text-red-600">{metaError}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {destinationRegions.map((r) => {
            const selected = regions.includes(r.code);
            return (
              <button
                key={r.code}
                type="button"
                onClick={() => toggleRegion(r.code)}
                aria-pressed={selected}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  selected ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {r.name}
              </button>
            );
          })}
          {destinationRegions.length === 0 && !metaError && <p className="text-sm text-slate-400">Loading destinations…</p>}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>When</FieldLabel>
          <p className="text-sm text-slate-500">Departure window</p>
        </div>
        <div />
        <LabeledInput label="From">
          <input
            type="date"
            value={departureFrom}
            onChange={(e) => setDepartureFrom(e.target.value)}
            className={INPUT_CLASS}
            required
          />
        </LabeledInput>
        <LabeledInput label="To">
          <input type="date" value={departureTo} onChange={(e) => setDepartureTo(e.target.value)} className={INPUT_CLASS} required />
        </LabeledInput>
        <LabeledInput label="Trip length, min days">
          <input
            type="number"
            min={1}
            max={90}
            value={tripLengthMin}
            onChange={(e) => setTripLengthMin(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </LabeledInput>
        <LabeledInput label="Trip length, max days">
          <input
            type="number"
            min={1}
            max={90}
            value={tripLengthMax}
            onChange={(e) => setTripLengthMax(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </LabeledInput>
      </section>

      <section>
        <FieldLabel>Budget</FieldLabel>
        <LabeledInput label="Max total per person (CAD)">
          <input type="number" min={1} value={maxTotal} onChange={(e) => setMaxTotal(Number(e.target.value))} className={INPUT_CLASS} />
        </LabeledInput>
      </section>

      <details className="group rounded-xl border border-slate-200 p-4 open:pb-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700 select-none">More options</summary>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <LabeledInput label="Max extra ground travel (min)">
            <input
              type="number"
              min={0}
              value={maxGroundMinutes}
              onChange={(e) => setMaxGroundMinutes(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </LabeledInput>
          <LabeledInput label="Only use alt. airport if saving ≥ (CAD/person)">
            <input
              type="number"
              min={0}
              value={minSavingPerPerson}
              onChange={(e) => setMinSavingPerPerson(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </LabeledInput>
          <LabeledInput label="Max stops">
            <input type="number" min={0} max={2} value={maxStops} onChange={(e) => setMaxStops(Number(e.target.value))} className={INPUT_CLASS} />
          </LabeledInput>
          <div />
          <LabeledInput label="Minimum normal layover (min)">
            <input
              type="number"
              min={0}
              value={minNormalMinutes}
              onChange={(e) => setMinNormalMinutes(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </LabeledInput>
          <LabeledInput label="Maximum normal layover (min)">
            <input
              type="number"
              min={0}
              value={maxNormalMinutes}
              onChange={(e) => setMaxNormalMinutes(Number(e.target.value))}
              className={INPUT_CLASS}
            />
          </LabeledInput>
        </div>
      </details>

      {formError && <p className="text-sm text-red-600">{formError}</p>}

      <button
        type="submit"
        className="w-full rounded-full bg-sky-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
      >
        Find smarter trips
      </button>
    </form>
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
