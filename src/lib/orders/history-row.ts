/**
 * One order_history row in the shape the order detail panel consumes.
 *
 * The database columns are `status_from` / `status_to`; the API renames them to
 * `from_status` / `to_status`. Anything that puts a history row into the panel's
 * SWR cache has to go through this rename, or HistoryTimeline reads
 * `entry.to_status` as undefined and presentStatus throws on
 * `status.startsWith`.
 */
// A type alias, not an interface: only aliases get an implicit index signature,
// which is what lets an entry satisfy the Record<string, unknown> row type the
// realtime cache is written in terms of.
export type OrderHistoryEntry = {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_id: string | null;
  actor_type: string | null;
  created_at: string;
};

/**
 * Map a raw `order_history` row to the panel's shape.
 *
 * Used by the API route and by the realtime subscriber, which is the point:
 * a realtime INSERT delivers the raw table row, and prepending it unmapped is
 * exactly the bug this exists to prevent.
 */
export function toHistoryEntry(row: Record<string, unknown>): OrderHistoryEntry {
  return {
    id: row.id as string,
    from_status: (row.status_from as string | null) ?? null,
    to_status: row.status_to as string,
    note: (row.note as string | null) ?? null,
    actor_id: (row.actor_id as string | null) ?? null,
    actor_type: (row.actor_type as string | null) ?? null,
    created_at: row.created_at as string,
  };
}
