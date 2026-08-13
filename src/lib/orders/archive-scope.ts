import { TERMINAL_STATUSES, type OrderStatus } from "@/types/order-status";

/**
 * The archive's membership set — one exported constant, deliberately.
 *
 * The archive page used to carry its own four-value copy of this list that
 * omitted `cancelled`. The summary counted cancelled orders in its total but
 * had no tile for them (so the tiles could never sum to 100%), and the realtime
 * filter dropped cancelled rows out of a table that had just fetched them.
 * Anything that needs "what is in the archive" reads this.
 */
export const ARCHIVE_STATUSES: OrderStatus[] = TERMINAL_STATUSES;

const isArchiveStatus = (v: string): v is OrderStatus =>
  (ARCHIVE_STATUSES as readonly string[]).includes(v);

/**
 * Parse the `status` query parameter into the statuses an archive query should
 * ask for.
 *
 * Intersects with {@link ARCHIVE_STATUSES}, so naming a non-terminal status
 * cannot pull live orders into the archive. An empty or fully-invalid request
 * falls back to the whole archive rather than to nothing — an unrecognised
 * filter should show everything, not silently show an empty page.
 */
export function resolveArchiveStatuses(csv: string | null | undefined): OrderStatus[] {
  if (!csv) return ARCHIVE_STATUSES;
  const requested = Array.from(
    new Set(csv.split(",").map((s) => s.trim()).filter(isArchiveStatus)),
  );
  return requested.length > 0 ? requested : ARCHIVE_STATUSES;
}

/**
 * How long an order stays in the working Commandes list after it finishes,
 * before the auto-archive rule puts it away. Counted from `terminal_at`, not
 * from `created_at`: an order rejected today is still worth seeing for a month
 * regardless of how long ago the customer ordered.
 */
export const DEFAULT_ARCHIVE_AFTER_DAYS = 30;

/**
 * Where a finished order currently lives.
 *
 *   all       every finished order, wherever it sits — what the archive page
 *             reports on, because the analysis is about outcomes, not tidiness
 *   eligible  finished long enough ago to be put away, but still in the list
 *   archived  already put away
 *   recent    finished too recently to be put away automatically
 *
 * Finishing and archiving are separate events: `terminal_at` records the first,
 * `archived_at` the second, and only the second affects what the Commandes
 * list shows.
 */
export type ArchiveState = "all" | "eligible" | "archived" | "recent";

const ARCHIVE_STATES: ArchiveState[] = ["all", "eligible", "archived", "recent"];

export function resolveArchiveState(raw: string | null | undefined): ArchiveState {
  const v = (raw ?? "").trim() as ArchiveState;
  // Anything unrecognised widens to the whole archive rather than collapsing to
  // an empty page — an unknown filter should never look like "no results".
  return ARCHIVE_STATES.includes(v) ? v : "all";
}
