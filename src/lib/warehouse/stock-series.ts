/**
 * The 14-day line on every stock row: a product's balance at the END of each
 * market day, read from `inventory_log.balance_after` and carried forward.
 *
 * Replaces `get_product_stock_series` on the stock route. That RPC filled a day
 * with no movement on or before it with TODAY's stock, so a product that lost
 * 14 units today drew a flat line at today's figure — the one movement the line
 * exists to show was erased. Before its first movement a product held that
 * movement's `balance_after − change`; that is what is drawn instead.
 *
 * `balance_after` is the product's MARKET total on every ledger row (variants
 * and buildings never change that), so one chain per product is the whole truth.
 */

export interface SeriesLedgerRow {
  change: number;
  balance_after: number;
  created_at: string;
}

/** `YYYY-MM-DD` of an instant, in a time zone. */
function dayKey(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The last `n` market days, oldest first, ending today in `timeZone`. */
export function lastDays(n: number, timeZone: string, now: Date = new Date()): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(dayKey(new Date(now.getTime() - i * 86_400_000), timeZone));
  return days;
}

/**
 * One value per day in `days` (oldest first). `rows` are ONE product's ledger
 * rows, any order, possibly including rows from before the window — they only
 * serve as the opening balance.
 */
export function stockSeries(
  rows: SeriesLedgerRow[],
  currentStock: number,
  days: string[],
  timeZone: string,
): number[] {
  if (rows.length === 0) return days.map(() => currentStock);
  const ordered = rows
    .map((r) => ({ ...r, day: dayKey(new Date(r.created_at), timeZone) }))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const opening = ordered[0].balance_after - ordered[0].change;

  let i = 0;
  let balance = opening;
  return days.map((d) => {
    while (i < ordered.length && ordered[i].day <= d) {
      balance = ordered[i].balance_after;
      i++;
    }
    return balance;
  });
}
