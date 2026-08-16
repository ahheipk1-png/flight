// Generates data/seed/airports_world.json from OurAirports' public-domain
// dataset (https://ourairports.com/data/ -- CC0 / public domain, mirrored
// at davidmegginson.github.io/ourairports-data). Run manually when the
// world airport list needs refreshing; the output is committed, not
// fetched at build or run time.
//
// Filters to airports with scheduled passenger service and a real IATA
// code, then groups by (municipality, country) into "cities" so a picker
// can offer "Tokyo (HND, NRT)" as one selectable place instead of forcing
// users to already know which specific airport code they want.
//
// Also builds a `countries[]` list -- picking a country in the UI expands
// to several of its cities at once (NOT one giant comma-joined airport
// group: some countries have 40+ airports with scheduled service, and
// SerpApi's departure_id/arrival_id has no documented limit on how many
// comma-separated codes it accepts, so joining "every airport in Spain"
// into one call is an unverified risk this avoids entirely by using
// multiple normal destination groups instead, the same mechanism as
// picking several cities by hand).
//
// IMPORTANT CAVEAT: OurAirports has no passenger-traffic ranking, so
// "which cities matter most in this country" is approximated by
// `type: large_airport` (its own coarse, hand-maintained classification)
// with `medium_airport` as filler -- not a true significance ranking. For
// small/mid countries this is normally fine; for countries with many
// large airports (the US, China, ...) the capped list is a reasonable
// but not authoritative sample, not necessarily THE top N cities.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const COUNTRIES_URL = "https://davidmegginson.github.io/ourairports-data/countries.csv";
const OUT_PATH = fileURLToPath(new URL("../data/seed/airports_world.json", import.meta.url));

// A defensive ceiling only, not a "top N" cutoff: the downstream search
// pipeline already prunes down to a manageable candidate set regardless
// of how many destination groups it starts from (see pruning.ts), so
// capping here bought nothing but harm -- an earlier version capped at
// 12 and alphabetical order silently dropped Tokyo and Osaka from
// Japan's list. 100 is just larger than any real country's large-tier
// city count (the biggest, the US, has ~90).
const MAX_CITIES_PER_COUNTRY = 100;

// Minimal RFC4180 CSV parser -- good enough for OurAirports' well-formed
// export (quoted fields, doubled-quote escaping, no embedded newlines
// inside unquoted fields).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchCsv(url) {
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed for ${url}: HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  const header = rows[0];
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  return { rows: rows.slice(1), col };
}

async function main() {
  const [{ rows: airportRows, col }, { rows: countryRows, col: countryCol }] = await Promise.all([
    fetchCsv(AIRPORTS_URL),
    fetchCsv(COUNTRIES_URL),
  ]);

  const countryNames = new Map();
  for (const r of countryRows) {
    const code = r[countryCol.code]?.trim();
    const name = r[countryCol.name]?.trim();
    if (code && name) countryNames.set(code, name);
  }

  const airports = [];
  const typeByIata = new Map();
  for (const r of airportRows) {
    if (r.length < col.length) continue;
    const type = r[col.type];
    if (type !== "large_airport" && type !== "medium_airport") continue;
    if (r[col.scheduled_service] !== "yes") continue;
    const iata = r[col.iata_code]?.trim();
    if (!iata || iata.length !== 3) continue;
    const lat = Number(r[col.latitude_deg]);
    const lon = Number(r[col.longitude_deg]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    airports.push({
      iata,
      name: r[col.name]?.trim() ?? "",
      city: r[col.municipality]?.trim() || r[col.name]?.trim() || iata,
      country: r[col.iso_country]?.trim() ?? "",
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
    });
    // First writer wins on a duplicate IATA below, so record its type now
    // rather than risk it being overwritten by a lower-priority dup.
    if (!typeByIata.has(iata)) typeByIata.set(iata, type);
  }

  // Some airports share an IATA code in raw OurAirports data (rare data
  // quality issue, e.g. decommissioned duplicates) -- keep the first
  // (large_airport rows are processed before medium, and the source is
  // otherwise stable), so downstream code can treat IATA as a unique key.
  const byIata = new Map();
  for (const a of airports) {
    if (!byIata.has(a.iata)) byIata.set(a.iata, a);
  }
  const deduped = [...byIata.values()].sort((a, b) => a.iata.localeCompare(b.iata));

  // Group into cities for the picker -- same (city, country) pair.
  const cityMap = new Map();
  for (const a of deduped) {
    const key = `${a.city}|${a.country}`;
    let city = cityMap.get(key);
    if (!city) {
      city = { city: a.city, country: a.country, airports: [] };
      cityMap.set(key, city);
    }
    city.airports.push(a.iata);
  }
  const cities = [...cityMap.values()].sort((a, b) => a.city.localeCompare(b.city));

  // A city ranks "large" if any of its airports do -- see the caveat in
  // the module comment above.
  function cityRank(city) {
    return city.airports.some((iata) => typeByIata.get(iata) === "large_airport") ? 0 : 1;
  }

  const citiesByCountry = new Map();
  for (const c of cities) {
    if (!c.country) continue;
    const list = citiesByCountry.get(c.country) ?? [];
    list.push(c);
    citiesByCountry.set(c.country, list);
  }

  const countries = [];
  for (const [code, list] of citiesByCountry) {
    const sorted = [...list].sort((a, b) => cityRank(a) - cityRank(b) || a.city.localeCompare(b.city));
    countries.push({
      code,
      name: countryNames.get(code) ?? code,
      cities: sorted.slice(0, MAX_CITIES_PER_COUNTRY).map((c) => ({ city: c.city, airports: c.airports })),
    });
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    _comment:
      "Generated by scripts/build-airports.mjs from OurAirports (public domain). Do not hand-edit -- rerun the script instead.",
    generated_at: new Date().toISOString().slice(0, 10),
    airports: deduped,
    cities,
    countries,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out), "utf8");
  console.log(
    `Wrote ${deduped.length} airports across ${cities.length} cities and ${countries.length} countries -> ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
