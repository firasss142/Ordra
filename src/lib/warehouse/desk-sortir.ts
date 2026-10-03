/**
 * Desk « Sortir » — the small rules behind the table, kept pure so they are
 * tested rather than re-derived in a component.
 */

export interface DeskAge {
  unit: "now" | "hours" | "days";
  n: number;
  /** Past two days on the bench: the age is shown as a warning chip. */
  late: boolean;
}

/**
 * The bench age as the desk prints it: « à l'instant », whole hours under a
 * day, then whole days. Nobody reads "95 h" as four days.
 */
export function deskAge(hours: number): DeskAge {
  const h = Math.max(0, hours);
  const late = h > 48;
  if (h < 1) return { unit: "now", n: 0, late };
  if (h < 24) return { unit: "hours", n: Math.floor(h), late };
  return { unit: "days", n: Math.floor(h / 24), late };
}

/** The customer's first name — the desk names people, it does not file them. */
export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * The UTC instant of midnight in `tz` on the day `now` falls in there.
 * A UTC boundary would split a Libyan evening across two days.
 */
export function zonedDayStartIso(tz: string, now: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const guess = new Date(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = asUtc - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

/** A set-aside order, as read for the dead-carrier share. */
export interface SetAsideRow {
  warehouse_id: string | null;
  carrier_extra: Record<string, unknown> | null;
  carrier: { name: string; is_active: boolean } | null;
}

export interface DeadShare {
  carrier: string;
  n: number;
}

/**
 * Of the parcels taken off the bench, how many belong to a carrier that is
 * switched off (`carriers.is_active = false`) — per building, largest first.
 * Same "ours" rule as `get_warehouse_queue_stats`: a parcel the carrier ships
 * from its own warehouse was never on our bench.
 */
export function deadCarrierBySite(rows: SetAsideRow[]): Record<string, DeadShare[]> {
  const bySite = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.warehouse_id || !r.carrier || r.carrier.is_active) continue;
    if (String(r.carrier_extra?.fulfil_from_carrier_warehouse ?? "") === "true") continue;
    const site = bySite.get(r.warehouse_id) ?? new Map<string, number>();
    site.set(r.carrier.name, (site.get(r.carrier.name) ?? 0) + 1);
    bySite.set(r.warehouse_id, site);
  }
  const out: Record<string, DeadShare[]> = {};
  for (const [site, counts] of bySite) {
    out[site] = [...counts.entries()]
      .map(([carrier, n]) => ({ carrier, n }))
      .sort((a, b) => b.n - a.n || a.carrier.localeCompare(b.carrier));
  }
  return out;
}

export interface FoldPart {
  site: string;
  n: number;
  dead: DeadShare[];
}

export interface FoldSummary {
  total: number;
  parts: FoldPart[];
}

/**
 * The fold row under the table: the set-aside parcels per building, in the
 * buildings' own order, without the buildings that have none.
 */
export function foldSummary(
  sites: Array<{ id: string; name: string }>,
  setAside: Record<string, number>,
  dead: Record<string, DeadShare[]>,
): FoldSummary {
  const parts = sites
    .map((s) => ({ site: s.name, n: Number(setAside[s.id] ?? 0) || 0, dead: dead[s.id] ?? [] }))
    .filter((p) => p.n > 0);
  return { total: parts.reduce((sum, p) => sum + p.n, 0), parts };
}
