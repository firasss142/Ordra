import type { Group, ScheduledSummary, ToShipRow } from "./types";

const UNKNOWN_CITY_LABEL = "—";

function buildGroups(
  rows: ToShipRow[],
  keyOf: (r: ToShipRow) => string,
  labelOf: (r: ToShipRow) => string,
): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = keyOf(r);
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(r);
      existing.totalQuantity += r.quantity;
    } else {
      map.set(key, { key, label: labelOf(r), rows: [r], totalQuantity: r.quantity });
    }
  }
  return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
}

export function groupRowsByCity(rows: ToShipRow[]): Group[] {
  return buildGroups(
    rows,
    (r) => r.customer_city ?? UNKNOWN_CITY_LABEL,
    (r) => r.customer_city ?? UNKNOWN_CITY_LABEL,
  );
}

export function groupRowsByProduct(rows: ToShipRow[]): Group[] {
  return buildGroups(
    rows,
    (r) => r.product_id ?? `name:${r.product_name}`,
    (r) => r.product_name,
  );
}

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function summarizeScheduled(rows: ToShipRow[], now: Date): ScheduledSummary {
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const dayAfterStart = tomorrowStart + 24 * 60 * 60 * 1000;

  const summary: ScheduledSummary = {
    overdue: 0,
    today: 0,
    todayAuto: 0,
    tomorrow: 0,
    later: 0,
  };

  for (const r of rows) {
    if (r.status !== "dispatch_scheduled" || !r.scheduled_at) continue;
    const t = new Date(r.scheduled_at).getTime();
    if (isNaN(t)) continue;

    if (t < todayStart) summary.overdue += 1;
    else if (t < tomorrowStart) {
      summary.today += 1;
      if (r.scheduled_auto) summary.todayAuto += 1;
    } else if (t < dayAfterStart) summary.tomorrow += 1;
    else summary.later += 1;
  }
  return summary;
}
