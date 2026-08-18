/**
 * Client-safe formatting for the investor portal (no server imports).
 *
 * House rules: digits always come from the fr-TN formatter (space thousands,
 * comma decimals) even in Arabic; the currency is a demoted suffix; the whole
 * figure is wrapped in LRI…PDI so RTL never reorders "+1 669 LYD" into
 * "1 669+". No cross-currency arithmetic ever happens here.
 */
const LRI = "⁦";
const PDI = "⁩";
const NBSP = " ";
const MINUS = "−";

const nfCache = new Map<number, Intl.NumberFormat>();
function nf(dp: number): Intl.NumberFormat {
  let f = nfCache.get(dp);
  if (!f) {
    f = new Intl.NumberFormat("fr-TN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    nfCache.set(dp, f);
  }
  return f;
}

export function fmtNum(n: number, dp = 0): string {
  const v = nf(dp).format(Math.abs(n)).replace(/[‎‏؜]/g, "");
  return (n < 0 && /[1-9]/.test(v) ? MINUS : "") + v;
}

export function fmtSigned(n: number, dp = 0): string {
  const v = nf(dp).format(Math.abs(n)).replace(/[‎‏؜]/g, "");
  if (!/[1-9]/.test(v)) return v;
  return (n < 0 ? MINUS : "+") + v;
}

export function currencyLabel(currency: string | null | undefined, locale: string): string {
  if (!currency) return "";
  if (locale === "ar") return currency === "LYD" ? "د.ل" : currency === "TND" ? "د.ت" : currency;
  return currency;
}

export function money(n: number, currency: string | null | undefined, locale: string, dp = 0): string {
  return `${LRI}${fmtNum(n, dp)}${NBSP}${currencyLabel(currency, locale)}${PDI}`;
}

export function moneySigned(n: number, currency: string | null | undefined, locale: string, dp = 0): string {
  return `${LRI}${fmtSigned(n, dp)}${NBSP}${currencyLabel(currency, locale)}${PDI}`;
}

export function bidi(s: string): string {
  return `${LRI}${s}${PDI}`;
}

export function pct(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${LRI}${fmtNum(n, dp)}${NBSP}%${PDI}`;
}

const dfCache = new Map<string, Intl.DateTimeFormat>();
function df(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = locale + JSON.stringify(opts);
  let f = dfCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-TN", { timeZone: "UTC", ...opts });
    dfCache.set(k, f);
  }
  return f;
}

/** "17 août" / "17 أغسطس" for a YYYY-MM-DD. */
export function dateShort(iso: string, locale: string): string {
  return df(locale, { day: "numeric", month: "short" }).format(new Date(iso + "T00:00:00Z"));
}
/** "17 août 2026". */
export function dateLong(iso: string, locale: string): string {
  return df(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T00:00:00Z"));
}
/** For timestamps: "17 août · 12:04". */
export function dateTimeShort(ts: string, locale: string): string {
  const d = new Date(ts);
  const day = df(locale, { day: "numeric", month: "short", timeZone: undefined }).format(d);
  const time = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-TN", { hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day} · ${time}`;
}

/** Minutes since an ISO timestamp (>= 0). */
export function minutesSince(ts: string | null | undefined, now = Date.now()): number | null {
  if (!ts) return null;
  return Math.max(0, Math.round((now - Date.parse(ts)) / 60_000));
}
