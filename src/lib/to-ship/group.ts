import type {
  Group,
  ScheduledSummary,
  Subgrouping,
  ToShipFilters,
  ToShipRow,
} from "./types";

const UNKNOWN_CITY_LABEL = "—";
const UNASSIGNED_CARRIER_KEY = "__unassigned__";

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

export function groupRowsByCarrier(
  rows: ToShipRow[],
  carrierMap: Map<string, string>,
  unassignedLabel = "Unassigned",
): Group[] {
  const groups = buildGroups(
    rows,
    (r) => r.scheduled_carrier_id ?? UNASSIGNED_CARRIER_KEY,
    (r) => {
      const id = r.scheduled_carrier_id;
      if (!id) return unassignedLabel;
      return carrierMap.get(id) ?? id;
    },
  );
  const unassigned = groups.find((g) => g.key === UNASSIGNED_CARRIER_KEY);
  const rest = groups.filter((g) => g.key !== UNASSIGNED_CARRIER_KEY);
  return unassigned ? [...rest, unassigned] : rest;
}

export type ScheduleBucket = "overdue" | "today" | "tomorrow" | "later" | "unscheduled";

export function bucketOf(row: ToShipRow, now: Date): ScheduleBucket | null {
  if (row.status !== "dispatch_scheduled" || !row.scheduled_at) {
    if (row.status === "confirmed" || row.status === "scanned") return "unscheduled";
    return null;
  }
  const t = new Date(row.scheduled_at).getTime();
  if (isNaN(t)) return "unscheduled";
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const dayAfterStart = tomorrowStart + 24 * 60 * 60 * 1000;
  if (t < todayStart) return "overdue";
  if (t < tomorrowStart) return "today";
  if (t < dayAfterStart) return "tomorrow";
  return "later";
}

const SCHEDULE_ORDER: ScheduleBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "later",
  "unscheduled",
];

const SCHEDULE_LABELS: Record<ScheduleBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  later: "Later",
  unscheduled: "Unscheduled",
};

export function groupRowsBySchedule(
  rows: ToShipRow[],
  now: Date,
  labels: Partial<Record<ScheduleBucket, string>> = {},
): Group[] {
  const buckets = new Map<ScheduleBucket, Group>();
  for (const r of rows) {
    const b = bucketOf(r, now);
    if (!b) continue;
    const existing = buckets.get(b);
    if (existing) {
      existing.rows.push(r);
      existing.totalQuantity += r.quantity;
    } else {
      buckets.set(b, {
        key: b,
        label: labels[b] ?? SCHEDULE_LABELS[b],
        rows: [r],
        totalQuantity: r.quantity,
      });
    }
  }
  return SCHEDULE_ORDER.map((k) => buckets.get(k)).filter((g): g is Group => Boolean(g));
}

const STATUS_ORDER = ["confirmed", "dispatch_scheduled", "scanned"] as const;
type ToShipStatus = (typeof STATUS_ORDER)[number];

const STATUS_LABELS: Record<ToShipStatus, string> = {
  confirmed: "Confirmed",
  dispatch_scheduled: "Scheduled",
  scanned: "Scanned",
};

export function groupRowsByStatus(
  rows: ToShipRow[],
  labels: Partial<Record<ToShipStatus, string>> = {},
): Group[] {
  const buckets = new Map<ToShipStatus, Group>();
  for (const r of rows) {
    if (!STATUS_ORDER.includes(r.status as ToShipStatus)) continue;
    const k = r.status as ToShipStatus;
    const existing = buckets.get(k);
    if (existing) {
      existing.rows.push(r);
      existing.totalQuantity += r.quantity;
    } else {
      buckets.set(k, {
        key: k,
        label: labels[k] ?? STATUS_LABELS[k],
        rows: [r],
        totalQuantity: r.quantity,
      });
    }
  }
  return STATUS_ORDER.map((k) => buckets.get(k)).filter((g): g is Group => Boolean(g));
}

export function groupRowsFlat(rows: ToShipRow[], label = "All"): Group[] {
  if (rows.length === 0) return [];
  const totalQuantity = rows.reduce((sum, r) => sum + r.quantity, 0);
  return [{ key: "all", label, rows: [...rows], totalQuantity }];
}

export function applyFilters(rows: ToShipRow[], filters: ToShipFilters): ToShipRow[] {
  const { productId, city } = filters;
  if (!productId && !city) return rows;
  return rows.filter((r) => {
    if (productId && r.product_id !== productId) return false;
    if (city && r.customer_city !== city) return false;
    return true;
  });
}

export function applySubgroup(groups: Group[], subBy: Subgrouping): Group[] {
  if (subBy === "none") return groups;
  if (subBy === "city") {
    return groups.map((g) => ({
      ...g,
      subgroups: groupRowsByCity(g.rows),
    }));
  }
  return groups;
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
