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
