import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * « Pas un doublon » (Commandes répétées › En double): the manager says these
 * orders are not copies of each other. Every member is written to
 * duplicate_dismissals; a group whose every member is there is not shown again.
 * A NEW order from the same customer is not dismissed, so it brings the group
 * back — the decision covered the orders that were on screen, not the future.
 */
export async function readDismissed(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Set();
  try {
    const { data, error } = await supabase.from("duplicate_dismissals").select("order_id").in("order_id", unique);
    if (error || !data) return new Set();
    return new Set((data as { order_id: string }[]).map((r) => r.order_id));
  } catch {
    // Fails open: a dismissal we cannot read shows the duplicate, never breaks the list.
    return new Set();
  }
}

export function dropDismissedGroups<G extends { members: { id: string }[] }>(groups: G[], dismissed: Set<string>): G[] {
  if (!dismissed.size) return groups;
  return groups.filter((g) => !g.members.every((m) => dismissed.has(m.id)));
}

/** A dismissed order no longer counts its dismissed siblings as copies. */
export function siblingsAfterDismissal<S extends { id: string }>(ownId: string, siblings: S[], dismissed: Set<string>): S[] {
  if (!dismissed.has(ownId)) return siblings;
  return siblings.filter((s) => !dismissed.has(s.id));
}
