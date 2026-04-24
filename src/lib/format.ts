const currencyFormatters = new Map<string, Intl.NumberFormat>();
function getCurrencyFormatter(market: string): Intl.NumberFormat {
  let fmt = currencyFormatters.get(market);
  if (!fmt) {
    if (market === "LY") {
      fmt = new Intl.NumberFormat("ar-LY", {
        style: "currency",
        currency: "LYD",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
    } else {
      fmt = new Intl.NumberFormat("fr-TN", {
        style: "currency",
        currency: "TND",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
    }
    currencyFormatters.set(market, fmt);
  }
  return fmt;
}

export function formatCurrency(amount: number, market: string): string {
  return getCurrencyFormatter(market).format(amount);
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function getDateFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = dateFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(
      locale === "ar" ? "ar-LY" : "fr-TN",
      { dateStyle: "short" }
    );
    dateFormatters.set(locale, fmt);
  }
  return fmt;
}

export function formatDate(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getDateFormatter(locale).format(d);
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
function getDateTimeFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = dateTimeFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    dateTimeFormatters.set(locale, fmt);
  }
  return fmt;
}

export function formatDateTime(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getDateTimeFormatter(locale).format(d);
}

const dayHeaderFormatters = new Map<string, Intl.DateTimeFormat>();
function getDayHeaderFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = dayHeaderFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    dayHeaderFormatters.set(locale, fmt);
  }
  return fmt;
}

export function formatDayHeader(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return locale === "ar" ? "اليوم" : "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return locale === "ar" ? "أمس" : "Hier";
  return getDayHeaderFormatter(locale).format(d);
}

export function minutesBetween(fromIso: string, toMs: number): number {
  return Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 60000));
}

export function formatExactTime(date: string | Date, _locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;

  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}`;
}
