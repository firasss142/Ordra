/** Display helpers for the mapping drawer. Figures follow the rest of the page (fr-FR grouping). */

export function fmtMoney(n: number, decimals = 0): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

export function fmtDay(iso: string, locale: string, opts: { year?: boolean; long?: boolean } = {}): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", {
    day: "numeric",
    month: opts.long ? "long" : "short",
    ...(opts.year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(d);
}

/** "il y a 14 min" — freshness, not a timestamp. */
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

export function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
