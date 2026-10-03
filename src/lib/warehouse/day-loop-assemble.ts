import {
  buildDayLoop,
  buildDecisions,
  buildTeam,
  type DayCounts,
  type DayLoop,
  type Decision,
  type TeamRow,
} from "./day-loop";

/**
 * Database rows → the « Aujourd'hui » payload.
 *
 * `day-loop-server.ts` issues the queries and hands their raw rows here; every
 * rule about what a row means is applied in this pure function and tested. The
 * definitions are the warehouse's existing ones, not new ones:
 *   - the bench is `get_warehouse_queue_stats` (ours, on the bench, `uploaded`);
 *   - only `to_be_returned` is receivable, `returning` is on its way;
 *   - a product is counted only by a `stock_count` ledger row — for a building,
 *     a row carrying that building's id.
 */

export interface QueueStatsRow {
  to_prepare?: number | null;
  oldest_prepare_hours?: number | null;
  returns_inbox?: number | null;
  set_aside?: number | null;
}

export interface DayLoopRows {
  warehouses: Array<{ id: string; code: string; name_fr: string; name_ar: string }>;
  /** `get_warehouse_queue_stats(market, site)` per building id. */
  queueBySite: Record<string, QueueStatsRow>;
  /** `get_warehouse_queue_stats(market, null)` — includes orders with no site. */
  marketQueue: QueueStatsRow;
  /** One row per `returning` order. */
  returning: Array<{ warehouse_id: string | null }>;
  /** Receptions still `draft` or `submitted`. */
  receptions: Array<{
    warehouse_id: string | null;
    /** `receptions.reference` (REC-LY-2026-0001). */
    reference?: string | null;
    status: string;
    expected_at: string | null;
    line_count: number;
  }>;
  /** Active products of the market. */
  productIds: string[];
  /** `inventory_log` rows with reason `stock_count`. */
  countRows: Array<{ product_id: string; warehouse_id: string | null }>;
  agents: Array<{ id: string; full_name: string | null; warehouse_id: string | null }>;
  /** `get_warehouse_leaderboard` — today's scans per operator. */
  leaderboard: Array<{ actor_id: string; scanned: number | string; last_scan_at: string | null }>;
  /** `get_warehouse_day_stats(market).scanned_today`. */
  marketScannedToday: number;
  /** `goal_daily_scanned`, null when the market never set one. */
  goal: number | null;
}

export interface DayLoopSite {
  id: string;
  code: string;
  name: string;
  counts: DayCounts;
  scannedToday: number;
}

export interface DayLoopPayload {
  /** The building the figures are about; null = the whole market. */
  focus: string | null;
  siteName: string | null;
  counts: DayCounts;
  loop: DayLoop;
  scannedToday: number;
  goal: number | null;
  /** Every building of the market, for the manager's split. Empty for an agent. */
  sites: DayLoopSite[];
  decisions: Decision[];
  team: TeamRow[];
  /**
   * The one reception expected in scope, named — « REC-LY-2026-0001 · en
   * retard d'1 j · aucune ligne » says more about a single document than an
   * aggregate does. Null when none or several are expected.
   */
  soleReception: SoleReception | null;
  /** Buildings with at least one `stock_count` row — 0 means no building's stock was ever counted. */
  countedSites: number;
}

export interface SoleReception {
  reference: string;
  /** Whole days past `expected_at`; 0 when due today, later or undated. */
  lateDays: number;
  /** No line at all: nothing to count when the truck comes. */
  empty: boolean;
}

const DAY_MS = 86_400_000;

const n =(v: number | string | null | undefined) => Number(v ?? 0) || 0;

function siteCounts(rows: DayLoopRows, siteId: string | null, today: string): DayCounts {
  const q = siteId ? rows.queueBySite[siteId] ?? {} : rows.marketQueue;
  const inScope = (w: string | null) => siteId === null || w === siteId;

  const receptions = rows.receptions.filter((r) => inScope(r.warehouse_id));
  // A product is counted at a building when a stock_count row carries that
  // building; for the market, when any row exists at all.
  const counted = new Set(
    rows.countRows.filter((c) => siteId === null || c.warehouse_id === siteId).map((c) => c.product_id),
  );
  const products = rows.productIds.length;

  return {
    toPrepare: n(q.to_prepare),
    oldestHours: n(q.oldest_prepare_hours),
    setAside: n(q.set_aside),
    returnsAtCarrier: n(q.returns_inbox),
    returnsOnTheWay: rows.returning.filter((r) => inScope(r.warehouse_id)).length,
    receptionsExpected: receptions.length,
    // Dates compare as ISO strings; a reception with no date is never late.
    receptionsLate: receptions.filter((r) => r.expected_at !== null && r.expected_at.slice(0, 10) < today).length,
    receptionsEmpty: receptions.filter((r) => r.line_count === 0).length,
    products,
    neverCounted: rows.productIds.filter((id) => !counted.has(id)).length,
  };
}

export function assembleDayLoop(
  rows: DayLoopRows,
  ctx: {
    focus: string | null;
    /** The market's local date, YYYY-MM-DD. */
    today: string;
    locale: string;
    /** Team and decisions are the manager's; an agent gets neither. */
    withManagerViews: boolean;
  },
): DayLoopPayload {
  const agentsBySite = new Map<string, Set<string>>();
  for (const a of rows.agents) {
    if (!a.warehouse_id) continue;
    const set = agentsBySite.get(a.warehouse_id) ?? new Set<string>();
    set.add(a.id);
    agentsBySite.set(a.warehouse_id, set);
  }
  const scannedAt = (siteId: string) => {
    const ids = agentsBySite.get(siteId) ?? new Set<string>();
    return rows.leaderboard.filter((l) => ids.has(l.actor_id)).reduce((s, l) => s + n(l.scanned), 0);
  };

  const nameOf = (w: DayLoopRows["warehouses"][number]) =>
    (ctx.locale === "ar" ? w.name_ar : w.name_fr) || w.name_fr;

  const sites: DayLoopSite[] = rows.warehouses.map((w) => ({
    id: w.id,
    code: w.code,
    name: nameOf(w),
    counts: siteCounts(rows, w.id, ctx.today),
    scannedToday: scannedAt(w.id),
  }));

  const counts = siteCounts(rows, ctx.focus, ctx.today);
  const scannedToday = ctx.focus ? scannedAt(ctx.focus) : rows.marketScannedToday;
  const focused = ctx.focus ? rows.warehouses.find((w) => w.id === ctx.focus) : undefined;

  const inScope = rows.receptions.filter((r) => ctx.focus === null || r.warehouse_id === ctx.focus);
  const only = inScope.length === 1 ? inScope[0] : null;
  const soleReception: SoleReception | null =
    only && only.reference
      ? {
          reference: only.reference,
          // Calendar days between two YYYY-MM-DD dates, both read as UTC
          // midnight so no time zone can shift the difference.
          lateDays:
            only.expected_at && only.expected_at.slice(0, 10) < ctx.today
              ? Math.round(
                  (Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${only.expected_at.slice(0, 10)}T00:00:00Z`)) / DAY_MS,
                )
              : 0,
          empty: only.line_count === 0,
        }
      : null;

  const countedSites = new Set(
    rows.countRows.map((c) => c.warehouse_id).filter((w): w is string => w !== null),
  ).size;

  return {
    soleReception,
    countedSites,
    focus: ctx.focus,
    siteName: focused ? nameOf(focused) : null,
    counts,
    loop: buildDayLoop({ counts, scannedToday, goal: rows.goal }),
    scannedToday,
    goal: rows.goal,
    sites: ctx.withManagerViews ? sites : [],
    decisions: ctx.withManagerViews ? buildDecisions(counts) : [],
    team: ctx.withManagerViews
      ? buildTeam(
          rows.agents
            .filter((a) => ctx.focus === null || a.warehouse_id === ctx.focus)
            .map((a) => ({ id: a.id, name: a.full_name ?? "—", warehouseId: a.warehouse_id })),
          rows.leaderboard.map((l) => ({ actorId: l.actor_id, scanned: n(l.scanned), lastScanAt: l.last_scan_at })),
        )
      : [],
  };
}
