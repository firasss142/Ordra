/** Minutes-of-day and ISO-day helpers for the control room. Pure; no React. */

const pad = (n: number) => String(n).padStart(2, "0");

/** 845 → "14:05" */
export function hm(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}

/** "14:05" or "1405" → 845; anything else → null. */
export function parseHM(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

const isoNoon = (day: string) => new Date(`${day}T12:00:00Z`);

export function addDays(day: string, k: number): string {
  const d = isoNoon(day);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((isoNoon(b).getTime() - isoNoon(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(day: string): number {
  return isoNoon(day).getUTCDay();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** An instant as the market sees it: its local day and minute of day. */
export function localDayMinute(iso: string, tz: string): { day: string; min: number } {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(iso))) p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Today in the market's time zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return localDayMinute(now.toISOString(), tz).day;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
}
