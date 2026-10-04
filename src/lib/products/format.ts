// Figures and dates as the products v6 prototype prints them.
//
// Whole dinars in the KPIs, one decimal per delivery, SPACE thousands and COMMA
// decimals in BOTH languages: ar-LY groups with a dot, so « 17.357 د.ل » reads as
// 17 dinars 357 dirhams to a Libyan eye (plans/products-redesign-v6.md §5).
//
// Bidi: a figure is isolated LEFT-TO-RIGHT (LRI … PDI) with its sign INSIDE the
// isolate, so « −1 816 » never becomes « 1 816− » in an Arabic sentence. LRI and
// not FSI: a figure has no strong character, and the first strong character FSI
// would find is the Arabic currency symbol (see lib/format.ts for the long story).
// Pure: used by the server for CSV-free text and by the client to render.

export const LRI = "⁦";
export const PDI = "⁩";
export const NBSP = " ";
export const MINUS = "−";

export type UiLocale = "fr" | "ar";

const SYMBOLS: Record<string, string> = { LYD: "د.ل", TND: "DT" };

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? currency;
}

/** |n| rounded to `d` decimals, NBSP thousands, comma decimals. */
export function groupDigits(n: number, d = 0): string {
  const fixed = Math.abs(n).toFixed(d);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return frac ? `${grouped},${frac}` : grouped;
}

/** The sign of n AFTER rounding to `d` decimals: −0.4 rounds to 0, not −0. */
export function signOf(n: number, d = 0, signed = false): string {
  const r = Number(n.toFixed(d));
  if (r < 0) return MINUS;
  if (signed && r > 0) return "+";
  return "";
}

export function numText(n: number, d = 0): string {
  return `${LRI}${signOf(n, d)}${groupDigits(n, d)}${PDI}`;
}

export function moneyText(
  n: number,
  currency: string,
  opts: { decimals?: number; signed?: boolean } = {},
): string {
  const d = opts.decimals ?? 0;
  return `${LRI}${signOf(n, d, opts.signed)}${groupDigits(n, d)}${PDI}${NBSP}${currencySymbol(currency)}`;
}

/** A ratio (0.55) as « 55 % » in French, « 55% » in Arabic. */
export function pctText(x: number, locale: UiLocale, d = 0): string {
  const body = `${signOf(x * 100, d)}${groupDigits(x * 100, d)}`;
  return `${LRI}${body}${locale === "ar" ? "%" : `${NBSP}%`}${PDI}`;
}

// ── dates ─────────────────────────────────────────────────────────────────

const INTL_LOCALE: Record<UiLocale, string> = { fr: "fr-FR", ar: "ar-LY-u-nu-latn" };

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: UiLocale, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${tz}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...opts, timeZone: tz });
    formatters.set(key, f);
  }
  return f;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** A calendar day (YYYY-MM-DD): « 4 sept. » / « 4 سبتمبر ». */
export function dayLabel(day: string, locale: UiLocale, withYear = false): string {
  const parts = fmt(locale, "UTC", {
    day: "numeric",
    month: locale === "fr" ? "short" : "long",
    year: "numeric",
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  const base = `${part(parts, "day")} ${part(parts, "month")}`;
  return withYear ? `${base} ${part(parts, "year")}` : base;
}

/** « 4 sept. – 3 oct. 2026 » — the year once, at the end. */
export function rangeLabel(from: string, to: string, locale: UiLocale): string {
  if (from === to) return dayLabel(to, locale, true);
  return `${dayLabel(from, locale)} – ${dayLabel(to, locale, true)}`;
}

/** An instant in the market's day: « mar. 29 sept., 17:15 » / « الثلاثاء 29 سبتمبر، 17:15 ». */
export function dayTimeLabel(iso: string, tz: string, locale: UiLocale): string {
  const parts = fmt(locale, tz, {
    weekday: locale === "fr" ? "short" : "long",
    day: "numeric",
    month: locale === "fr" ? "short" : "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const date = `${part(parts, "weekday")} ${part(parts, "day")} ${part(parts, "month")}`;
  const time = `${part(parts, "hour")}:${part(parts, "minute")}`;
  return `${date}${locale === "ar" ? "، " : ", "}${time}`;
}

/** An instant's day only, in the market's timezone: « 29 sept. ». */
export function instantDayLabel(iso: string, tz: string, locale: UiLocale): string {
  const parts = fmt(locale, tz, { day: "numeric", month: locale === "fr" ? "short" : "long" }).formatToParts(
    new Date(iso),
  );
  return `${part(parts, "day")} ${part(parts, "month")}`;
}
