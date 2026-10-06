/** Number, money, month and date formatting for the desk — one place, both languages. */
import { formatDisplayCurrencyCode } from "@/lib/markets";

const numLocale = (locale: string) => (locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR");

/**
 * French groups thousands with U+202F, which the app font draws with no width
 * (« 3984 » instead of « 3 984 ») — the same trap the ad-spend page met. A
 * no-break space reads right and never wraps.
 */
export const fmtNum = (n: number, locale: string) => new Intl.NumberFormat(numLocale(locale)).format(n).replace(/\u202F/g, "\u00A0");

export const fmtMoney = (n: number, locale: string, marketId: string | null) =>
  `${fmtNum(Math.round(n), locale)} ${formatDisplayCurrencyCode(null, marketId)}`;

/** "septembre" / "سبتمبر" for a YYYY-MM. */
export const monthName = (ym: string, locale: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(numLocale(locale), { month: "long", timeZone: "UTC" });

export const monthLabel = (ym: string, locale: string) => {
  const s = new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(numLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export const fmtDay = (iso: string, locale: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(numLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });

export const fmtTime = (iso: string, locale: string, tz: string) =>
  new Date(iso).toLocaleTimeString(numLocale(locale), { hour: "2-digit", minute: "2-digit", timeZone: tz });

export const currentMonthIn = (tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
