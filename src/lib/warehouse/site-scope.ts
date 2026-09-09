import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which building a warehouse request is about.
 *
 * Libya runs two physical warehouses, Tripoli and Benghazi, one per Darb
 * Assabil account. They are not interchangeable: a parcel uploaded to the
 * Benghazi account is prepared in Benghazi and handed to Darb Benghazi — handed
 * to Tripoli, it does not exist in their system. So the site is not a
 * convenience filter, it is who may touch the parcel at all.
 *
 * An agent is therefore PINNED to their own site and cannot widen it from the
 * client; a manager arbitrates between the two and narrows by choice.
 *
 * The site is not in the signed profile cookie (which carries only id, role and
 * market), so it is read from `users` — one lookup, and only for the role that
 * needs it. The RPCs re-check it server-side regardless: this is what the screen
 * shows, never the authority.
 */

export interface SiteFilter {
  /** null = every site of the market, OR nothing at all when `unassigned`. */
  warehouseId: string | null;
  /** True when the caller cannot widen it — an agent standing in one building. */
  pinned: boolean;
  /**
   * A warehouse agent nobody has assigned to a building yet. They see NOTHING.
   *
   * This reverses the original behaviour, which widened such an agent to the
   * whole market so the bench would not look broken. Production showed the cost:
   * an unassigned agent saw both buildings' parcels mixed together, and the SQL
   * guard stayed inert for them (it fires only when the agent AND the order both
   * carry a site). Unassigned meant unrestricted — precisely the hand-over
   * mistake the site model exists to prevent.
   *
   * An empty bench that names its reason is safe and self-correcting: it sends
   * the agent to their manager instead of to the wrong shelf.
   */
  unassigned: boolean;
}

export async function resolveSiteFilter(
  supabase: SupabaseClient,
  input: {
    actor: { id: string; role: string };
    /** The `warehouse_id` query parameter, if any. */
    requested: string | null;
  },
): Promise<SiteFilter> {
  const requested = input.requested && input.requested !== "all" ? input.requested : null;

  // Managers and super_admins have no building of their own; that is normal,
  // not an omission, so it never counts as unassigned.
  if (input.actor.role !== "warehouse_agent") {
    return { warehouseId: requested, pinned: false, unassigned: false };
  }

  const { data } = await supabase
    .from("users")
    .select("warehouse_id")
    .eq("id", input.actor.id)
    .maybeSingle<{ warehouse_id: string | null }>();

  const own = data?.warehouse_id ?? null;
  // Pinned either way: an agent never widens their own scope, and an agent with
  // no site is pinned to nothing rather than released onto the market.
  return own
    ? { warehouseId: own, pinned: true, unassigned: false }
    : { warehouseId: null, pinned: true, unassigned: true };
}
