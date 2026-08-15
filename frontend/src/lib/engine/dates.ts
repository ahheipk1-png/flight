// ISO-date ("YYYY-MM-DD") arithmetic helpers. All math is done in UTC so
// a viewer's local timezone can never shift a date across midnight.

const DAY_MS = 86_400_000;

export function addDaysIso(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

export function stridedDates(startIso: string, endIso: string, strideDays: number): string[] {
  const dates: string[] = [];
  let d = startIso;
  while (d <= endIso) {
    dates.push(d);
    d = addDaysIso(d, strideDays);
  }
  return dates;
}
