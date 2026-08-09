import {
  HARVEST_QUOTE_AMOUNT,
  type DarbQuoteResult,
} from "./darb-rate-quote";

/**
 * Harvest planning and orchestration for darb_shipping_rates.
 *
 * Everything network- and DB-shaped is INJECTED (`quote`, `upsert`, `sleep`,
 * `now`), so the whole run is unit-testable without mocking fetch or Supabase.
 * The pure halves — buildHarvestPlan / toRateUpsertRow / summarizeHarvest — carry
 * all the rules that matter and are tested directly.
 *
 * SIZE. 278 catalogue (city, area) combos x 2 Darb accounts = 556 cells. The
 * probe on 2026-08-08 measured p95 171ms with no throttling at 300ms spacing, so
 * the defaults below finish a full sweep in well under two minutes.
 *
 * RESUMABILITY. There is no cursor. The caller selects cells stalest-first and
 * caps them with `limit`; a run that cannot finish simply picks up the oldest
 * rows next cycle. buildHarvestPlan is deterministically ordered so that works.
 */

export interface HarvestCarrier {
  carrierId: string;
  /** The service plan to quote with. Probed portable across both accounts. */
  serviceId: string;
}

export interface HarvestDestination {
  city: string;
  area: string;
}

export interface HarvestCell {
  carrierId: string;
  serviceId: string;
  city: string;
  area: string;
}

/**
 * One cell per (carrier, destination). No service / value / paymentBy
 * dimensions: the probe established the quote is invariant to all three.
 */
export function buildHarvestPlan(input: {
  carriers: HarvestCarrier[];
  destinations: HarvestDestination[];
}): HarvestCell[] {
  const cells: HarvestCell[] = [];
  for (const carrier of input.carriers) {
    for (const dest of input.destinations) {
      cells.push({
        carrierId: carrier.carrierId,
        serviceId: carrier.serviceId,
        city: dest.city,
        area: dest.area,
      });
    }
  }
  return cells;
}

/**
 * Reorder a plan so the least-recently-attempted cells go first.
 *
 * This is what makes a `limit`-capped run resumable without any cursor: cells
 * never harvested (no row at all) come first, then the oldest quoted_at. A run
 * that only gets through half the catalogue picks up the other half next cycle.
 * Ties keep their plan order so the whole thing stays deterministic.
 */
export function orderCellsByStaleness(
  cells: HarvestCell[],
  quotedAtByKey: Map<string, string>,
): HarvestCell[] {
  return cells
    .map((cell, index) => ({ cell, index, at: quotedAtByKey.get(cellKey(cell)) }))
    .sort((a, b) => {
      if (a.at == null && b.at == null) return a.index - b.index;
      if (a.at == null) return -1; // never harvested — highest priority
      if (b.at == null) return 1;
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.cell);
}

/**
 * A unit separator, not a space: Darb city and area names legitimately contain
 * spaces ("جالو اوجلة", "بنغازي - استلام من المكتب"), so a space could make two
 * different (city, area) pairs collide on one key.
 */
const KEY_SEP = "\u001F";

/** Stable identity of a cell, matching the table's UNIQUE (carrier_id, city, area). */
export function cellKey(cell: {
  carrierId: string;
  city: string;
  area: string;
}): string {
  return [cell.carrierId, cell.city, cell.area].join(KEY_SEP);
}

export interface DarbRateUpsertRow {
  carrier_id: string;
  city: string;
  area: string;
  shipping_amount: number | null;
  currency: string;
  breakdown: Record<string, number> | null;
  quoted_with_service_id: string;
  quoted_with_amount: number;
  status: "ok" | "error";
  http_status: number | null;
  error_message: string | null;
  quoted_at: string;
  harvest_run_id: string;
}

/**
 * A failed quote yields shipping_amount null — NEVER 0. The DB CHECK enforces
 * the same invariant, and the upsert RPC preserves the previous good price
 * rather than overwriting it with this null.
 */
export function toRateUpsertRow(
  cell: HarvestCell,
  result: DarbQuoteResult,
  nowIso: string,
  runId: string,
): DarbRateUpsertRow {
  const base = {
    carrier_id: cell.carrierId,
    city: cell.city,
    area: cell.area,
    quoted_with_service_id: cell.serviceId,
    quoted_with_amount: HARVEST_QUOTE_AMOUNT,
    quoted_at: nowIso,
    harvest_run_id: runId,
  };

  if (result.ok) {
    return {
      ...base,
      shipping_amount: result.shippingAmount,
      currency: result.currency,
      breakdown: result.breakdown,
      status: "ok",
      http_status: null,
      error_message: null,
    };
  }

  return {
    ...base,
    shipping_amount: null,
    currency: "lyd",
    breakdown: null,
    status: "error",
    http_status: result.httpStatus,
    error_message: result.errorMessage,
  };
}

export interface HarvestCounts {
  requested: number;
  succeeded: number;
  failed: number;
}

export function summarizeHarvest(rows: DarbRateUpsertRow[]): HarvestCounts {
  const succeeded = rows.filter((r) => r.status === "ok").length;
  return { requested: rows.length, succeeded, failed: rows.length - succeeded };
}

export interface HarvestRunSummary extends HarvestCounts {
  status: "completed" | "partial";
  circuitOpened: boolean;
  skipped: number;
}

export interface RunHarvestDeps {
  cells: HarvestCell[];
  quote: (cell: HarvestCell) => Promise<DarbQuoteResult>;
  upsert: (rows: DarbRateUpsertRow[]) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  runId: string;
  /** Cap the cells processed this run; the rest are picked up next cycle. */
  limit?: number;
  delayMs?: number;
  batchSize?: number;
  /** Circuit breaker — a systematically broken account stops burning calls. */
  maxConsecutiveFailures?: number;
}

export async function runHarvest(deps: RunHarvestDeps): Promise<HarvestRunSummary> {
  const delayMs = deps.delayMs ?? 250;
  const batchSize = deps.batchSize ?? 50;
  const maxConsecutive = deps.maxConsecutiveFailures ?? 20;

  const planned = deps.limit != null ? deps.cells.slice(0, deps.limit) : deps.cells;

  const rows: DarbRateUpsertRow[] = [];
  let pending: DarbRateUpsertRow[] = [];
  let consecutiveFailures = 0;
  let circuitOpened = false;
  let processed = 0;

  const flush = async () => {
    if (pending.length === 0) return;
    await deps.upsert(pending);
    pending = [];
  };

  for (const cell of planned) {
    // A quote that throws is still a data point — record it and keep going.
    // One unreachable destination must not cost us the other 555.
    let result: DarbQuoteResult;
    try {
      result = await deps.quote(cell);
    } catch (e) {
      result = {
        ok: false,
        httpStatus: 0,
        errorMessage: e instanceof Error ? e.message : "quote threw",
      };
    }
    processed += 1;

    const row = toRateUpsertRow(cell, result, deps.now().toISOString(), deps.runId);
    rows.push(row);
    pending.push(row);
    if (pending.length >= batchSize) await flush();

    if (result.ok) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutive) {
        circuitOpened = true;
        break;
      }
    }

    if (delayMs > 0) await deps.sleep(delayMs);
  }

  await flush();

  const counts = summarizeHarvest(rows);
  return {
    ...counts,
    skipped: planned.length - processed,
    circuitOpened,
    status: counts.failed > 0 || circuitOpened ? "partial" : "completed",
  };
}
