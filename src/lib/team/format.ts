/**
 * Display helpers for the team pages. Locale-aware where it matters; the
 * pages render in fr or ar and every number goes through Intl.
 */
export function fmtNum(locale: string, n: number, digits = 0): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function fmtPct(locale: string, pct: number | null, digits = 1): string {
  if (pct === null || Number.isNaN(pct)) return "—";
  return `${fmtNum(locale, pct, digits)} %`;
}

/** Days with one decimal below 10, whole above; hours below one day. */
export function fmtAge(locale: string, ageDays: number): string {
  if (ageDays < 1) return `${fmtNum(locale, Math.max(1, Math.round(ageDays * 24)))} h`;
  return `${fmtNum(locale, ageDays, ageDays < 10 ? 1 : 0)} j`;
}

export function fmtTimeIn(locale: string, iso: string, tz: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function fmtDayShort(locale: string, isoDay: string, tz?: string): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", ...(tz ? { timeZone: tz } : {}) }).format(d);
}

export function fmtDateTimeIn(locale: string, iso: string, tz: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d),
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d),
  };
}

export type RelativeParts =
  | { kind: "now" }
  | { kind: "minutes"; value: number }
  | { kind: "hours"; value: number }
  | { kind: "yesterday"; time: string }
  | { kind: "date"; date: string };

/**
 * "il y a 16 min" / "hier 18:53" / "le 8 juillet" — the parts, so the caller
 * can run them through i18n.
 */
export function relativeParts(iso: string, now: Date, locale: string, tz: string): RelativeParts {
  const then = new Date(iso);
  const diffMin = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (diffMin < 1) return { kind: "now" };
  if (diffMin < 60) return { kind: "minutes", value: diffMin };
  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayOf(now);
  const thatDay = dayOf(then);
  if (thatDay === today) return { kind: "hours", value: Math.floor(diffMin / 60) };
  const y = new Date(now.getTime() - 86_400_000);
  if (thatDay === dayOf(y)) return { kind: "yesterday", time: fmtTimeIn(locale, iso, tz) };
  return { kind: "date", date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: tz }).format(then) };
}

/** Deterministic hue for an agent's letter avatar. */
export function agentColor(name: string): string {
  const palette = ["#B98900", "#8A5CF6", "#0F7A5C", "#2C6ECB", "#DB6B4A", "#6D7175", "#0E7490", "#A21CAF"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
