/**
 * Exact money math.
 *
 * Two precisions coexist deliberately. Read this before using either.
 *
 * ── cents (2dp) ────────────────────────────────────────────────────────────
 * Used by the market P&L path. `get_profitability_summary` aggregates
 * server-side as `round(value * 100)` and returns integer cents, so
 * load-summary.ts must divide by the same factor. That RPC was verified to
 * produce byte-identical output to the previous JS path across both markets;
 * changing its unit would silently move every figure on a shipped dashboard.
 *
 * ── millimes (3dp) ─────────────────────────────────────────────────────────
 * Used by the investor path (rollup, allocation, settlement, ledger). Every
 * money column is NUMERIC(10,3) — TND and LYD are both millime currencies —
 * so 3dp arithmetic is EXACT for stored values and rounds nothing at all.
 * Cents rounding is symmetric (±0.005 per row, not a systematic drift), which
 * is immaterial on a dashboard but avoidable when the same figure decides what
 * a person is actually paid.
 *
 * Consequence: a market P&L total and the sum of investor statements over the
 * same period can differ by sub-millime rounding. That is expected. Statements
 * are the authoritative payout record; the P&L is a management view.
 *
 * Do not mix them in one calculation.
 */

// ── cents — market P&L only ────────────────────────────────────────────────

/** Convert currency units to integer cents. Pairs with the P&L RPC. */
export function toCents(n: number): number {
  return Math.round(n * 100);
}

/** Convert integer cents back to currency units. */
export function fromCents(n: number): number {
  return n / 100;
}

// ── millimes — investor path only ──────────────────────────────────────────

/** Convert an amount in currency units to exact integer millimes. */
export function toMillimes(n: number): number {
  return Math.round(n * 1000);
}

/** Convert integer millimes back to currency units. */
export function fromMillimes(n: number): number {
  return n / 1000;
}
