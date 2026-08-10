/**
 * What "unassigned" means, in one place.
 *
 * Two endpoints answer this question — the sidebar badge
 * (`/api/orders/unassigned/count`) and the orders KPI tile
 * (`/api/orders/status-counts`) — and they disagreed. The badge filtered
 * `status = 'pending'`; the tile filtered only `assigned_to IS NULL`. On the
 * Libya market that is 9 orders versus 188, because 176 of those 188 had
 * already shipped or settled and were never going to need an agent again.
 *
 * A tile that says 188 next to a badge that says 9 does not have a rounding
 * problem, it has two definitions. §4.17 G: counts must not lie, and two counts
 * of the same thing must not tell two stories.
 *
 * The live definition is the narrow one: nobody owns it *and* it is still
 * waiting for its first call.
 */

/** The only status an order can be in while it still needs assigning. */
export const UNASSIGNED_STATUS = "pending" as const;

/**
 * Narrows a PostgREST query to orders awaiting an agent.
 *
 * Generic over the builder so it composes with a `head: true` count chain
 * without either caller importing Supabase's query types.
 */
export function whereUnassigned<T extends {
  eq(column: string, value: string): T;
  is(column: string, value: null): T;
}>(query: T): T {
  return query.eq("status", UNASSIGNED_STATUS).is("assigned_to", null);
}
