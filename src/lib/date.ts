export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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

const MS_PER_DAY = 86_400_000;

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
