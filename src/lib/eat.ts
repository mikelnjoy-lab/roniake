// Africa/Nairobi is fixed UTC+3 (no DST). All business-facing dates/times use EAT.
const OFFSET_MS = 3 * 60 * 60 * 1000;

/** Today's date in EAT as YYYY-MM-DD. */
export function eatToday(now = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** EAT wall-clock date + HH:mm → UTC instant. */
export function eatToUtc(date: string, time = "00:00"): Date {
  return new Date(`${date}T${time}:00+03:00`);
}

/**
 * Half-open UTC range [from, to) for an EAT selection. End time is inclusive to the
 * minute (e.g. 17:30 includes 17:30:59.999); an omitted end time covers the whole end day.
 */
export function eatRange(startDate: string, endDate: string, startTime?: string, endTime?: string) {
  const from = eatToUtc(startDate, startTime || "00:00");
  const to = endTime ? new Date(eatToUtc(endDate, endTime).getTime() + 60_000) : eatToUtc(addDays(endDate, 1));
  return { from, to };
}

export function presetRange(p: "today" | "yesterday" | "week" | "month"): { start: string; end: string } {
  const t = eatToday();
  if (p === "today") return { start: t, end: t };
  if (p === "yesterday") { const y = addDays(t, -1); return { start: y, end: y }; }
  if (p === "week") { const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7; return { start: addDays(t, -dow), end: t }; }
  return { start: `${t.slice(0, 8)}01`, end: t };
}

export function fmtEat(iso: string, withDate = true): string {
  return new Date(iso).toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(withDate ? { day: "2-digit", month: "short", year: "numeric" } : {}),
  });
}
