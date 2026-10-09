/**
 * Dates, money and status words for Journaux, in one place so the panels and
 * the feed never disagree. The super_admin reads it in French (no market →
 * French), but nothing here assumes it.
 */
export interface Fmt {
  locale: string;
  tz: string;
  now: Date;
  money(amount: unknown, currency: unknown): string;
  num(n: unknown): string;
  time(iso: string): string;
  date(iso: string): string;
  dateTime(iso: string): string;
  /** YYYY-MM-DD in the reader's zone — the feed's day groups. */
  dayKey(iso: string): string;
  relative(iso: string | null | undefined): string;
  status(s: unknown): string;
}

/**
 * `fixedNow` pins the clock (tests). Without it, `now` and `relative` read the
 * live clock: the screen builds its formatter once and refreshes every minute.
 */
export function makeFmt(locale: string, tz: string, statusLabel: (s: string) => string, fixedNow?: Date): Fmt {
  const clock = () => (fixedNow ? fixedNow.getTime() : Date.now());
  const intl = locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
  const n0 = new Intl.NumberFormat(intl, { maximumFractionDigits: 2 });
  const hm = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  const dm = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: tz });
  const ymd = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz });
  const rel = new Intl.RelativeTimeFormat(intl, { numeric: "auto" });

  const num = (n: unknown) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : n0.format(Number(n)));
  return {
    locale,
    tz,
    get now() {
      return new Date(clock());
    },
    num,
    money: (amount, currency) => (amount == null ? "—" : `${num(amount)} ${currency ?? ""}`.trim()),
    time: (iso) => hm.format(new Date(iso)),
    date: (iso) => dm.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)),
    dateTime: (iso) => `${dm.format(new Date(iso))}, ${hm.format(new Date(iso))}`,
    dayKey: (iso) => ymd.format(new Date(iso)),
    relative: (iso) => {
      if (!iso) return "—";
      let s = Math.round((Date.parse(iso) - clock()) / 1000);
      // A server stamp slightly ahead of this browser's clock is « now ».
      if (s > 0 && s < 60) s = 0;
      const a = Math.abs(s);
      if (a < 60) return rel.format(Math.round(s), "second");
      if (a < 3600) return rel.format(Math.round(s / 60), "minute");
      if (a < 86_400) return rel.format(Math.round(s / 3600), "hour");
      if (a < 30 * 86_400) return rel.format(Math.round(s / 86_400), "day");
      return dm.format(new Date(iso));
    },
    status: (s) => (typeof s === "string" ? statusLabel(s) : "—"),
  };
}
