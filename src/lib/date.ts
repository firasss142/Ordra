const MS_PER_DAY = 86_400_000;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoISO(daysAgo: number): string {
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return toISODate(todayMs - daysAgo * MS_PER_DAY);
}

export function lastNDaysPeriod(days: number): { from_date: string; to_date: string } {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError("days must be a positive integer");
  }
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from_date: toISODate(todayMs - (days - 1) * MS_PER_DAY),
    to_date: toISODate(todayMs),
  };
}

// N-day window ending at (and including) a given ISO end date — the clock-free
// counterpart to lastNDaysPeriod. Used to anchor a default period to the latest
// date that actually has data instead of always to "today".
export function lastNDaysEndingAt(
  days: number,
  endDateISO: string,
): { from_date: string; to_date: string } {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError("days must be a positive integer");
  }
  const endMs = parseISODate(endDateISO);
  return {
    from_date: toISODate(endMs - (days - 1) * MS_PER_DAY),
    to_date: endDateISO,
  };
}

// Clamp a default anchor to min(today, latest): if the market's latest activity
// is in the past, anchor there; otherwise (no data, or latest ≥ today) use today.
// Pure string comparison is safe for ISO YYYY-MM-DD dates.
export function anchorDate(today: string, latest: string | null): string {
  return latest && latest < today ? latest : today;
}

// The default period + preset for a dashboard/P&L view, anchored to real data.
// - Data today (or no data at all): single-day "today" — the existing default.
// - Latest data is in the past: a 30-day window ending at the latest data date,
//   so the view lands on a meaningful range instead of one sparse historical day.
// Shared by SSR and the client re-anchor effect so both agree on the same period.
export function anchoredDefaultPeriod(
  today: string,
  latest: string | null,
): { period: { from_date: string; to_date: string }; preset: "today" | "month" } {
  if (latest && latest < today) {
    return { period: lastNDaysEndingAt(30, latest), preset: "month" };
  }
  return { period: { from_date: today, to_date: today }, preset: "today" };
}

export function startOfWeekISO(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getTime() + diff * 86_400_000).toISOString().slice(0, 10);
}

export function startOfMonthISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export function startOfQuarterISO(): string {
  const d = new Date();
  const quarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth, 1))
    .toISOString()
    .slice(0, 10);
}

function parseISODate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function periodLengthDays(fromDate: string, toDate: string): number {
  const days = (parseISODate(toDate) - parseISODate(fromDate)) / MS_PER_DAY;
  return Math.round(days) + 1;
}

export function computePreviousPeriod(
  fromDate: string,
  toDate: string,
): { from_date: string; to_date: string } {
  const length = periodLengthDays(fromDate, toDate);
  const fromMs = parseISODate(fromDate);
  return {
    from_date: toISODate(fromMs - length * MS_PER_DAY),
    to_date: toISODate(fromMs - MS_PER_DAY),
  };
}
