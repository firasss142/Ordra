/** Display helpers for the mapping drawer. Figures follow the rest of the page (fr-FR grouping). */

/** U+202F (fr-FR grouping) has no width in Plus Jakarta Sans — a plain no-break space instead. */
export function fmtMoney(n: number, decimals = 0): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/\u202f/g, "\u00a0");
}

export function fmtPct(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

const dateLocale = (locale: string) => (locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR");

/** "6 juil.", "1ᵉʳ août" — French writes the first of the month as an ordinal. */
export function fmtDay(iso: string, locale: string, opts: { year?: boolean } = {}): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const s = new Intl.DateTimeFormat(dateLocale(locale), {
    day: "numeric",
    month: "short",
    ...(opts.year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(d);
  return locale === "ar" ? s : s.replace(/^1 /, "1ᵉʳ ");
}

export function fmtMonth(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(dateLocale(locale), { month: "short", timeZone: "UTC" }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
  );
}

/** Every day from `from` to `to`, inclusive (capped, so a bad range cannot hang a render). */
export function eachDay(from: string, to: string, cap = 800): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nextDay(iso: string): string {
  return addDays(iso, 1);
}

/** "il y a 14 minutes" — freshness, not a timestamp. */
export function relativeTime(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.round((then - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "fr", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

/** Today in the ad account's timezone — the day Meta is currently reporting. */
export function localToday(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
