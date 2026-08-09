export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h${minutes.toString().padStart(2, "0")}`;
}

export function formatDateRange(departIso: string, returnIso: string): string {
  const depart = new Date(`${departIso}T00:00:00`);
  const ret = new Date(`${returnIso}T00:00:00`);
  const optsShort: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const sameYear = depart.getFullYear() === ret.getFullYear();
  const start = depart.toLocaleDateString("en-CA", optsShort);
  const end = ret.toLocaleDateString("en-CA", sameYear ? optsShort : { ...optsShort, year: "numeric" });
  return `${start} – ${end}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

export function routeLabel(iatas: string[]): string {
  return iatas.join(" → ");
}
