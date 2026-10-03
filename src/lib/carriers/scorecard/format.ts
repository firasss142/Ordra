/**
 * How the Transporteurs page writes numbers and dates. Both languages keep
 * Latin digits and a space between thousands (as the rest of Ordra). French
 * puts a narrow space before %, Arabic none; French decimals take a comma,
 * Arabic a point. Dates are written in UTC from a YYYY-MM-DD so a week label
 * never slips a day in a browser's own time zone.
 */
const isAr = (locale: string) => locale === "ar";

export function fmtInt(_locale: string, n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n));
}

export function fmtPct(locale: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Math.round(v);
  return isAr(locale) ? `${n}%` : `${n} %`;
}

function fmtOne(locale: string, v: number): string {
  return new Intl.NumberFormat(isAr(locale) ? "en-US" : "fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(v);
}

/** Days with one decimal: « 1,2 » / « 1.2 » (the unit is added by the message). */
export function fmtDays(locale: string, v: number): string {
  return fmtOne(locale, v);
}

export function fmtPoints(locale: string, v: number): string {
  return fmtOne(locale, v);
}

export function fmtWeek(locale: string, isoDay: string): string {
  return new Intl.DateTimeFormat(isAr(locale) ? "ar-LY" : "fr-FR", { day: "numeric", month: isAr(locale) ? "long" : "short", timeZone: "UTC" })
    .format(new Date(`${isoDay.slice(0, 10)}T12:00:00Z`));
}

export function fmtDate(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(isAr(locale) ? "ar-LY" : "fr-FR", { day: "numeric", month: isAr(locale) ? "long" : "short", timeZone: "UTC" })
    .format(new Date(iso));
}

export function fmtMonth(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(isAr(locale) ? "ar-LY" : "fr-FR", { month: "long", timeZone: "UTC" }).format(new Date(iso));
}

/** « il y a 8 min » — the parts, so the caller can translate them. */
export function syncAge(iso: string, now: Date): { unit: "min" | "hour" | "day"; n: number } {
  const min = Math.max(1, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return { unit: "min", n: min };
  if (min < 24 * 60) return { unit: "hour", n: Math.floor(min / 60) };
  return { unit: "day", n: Math.floor(min / (24 * 60)) };
}
