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
  /** null = every site of the market. */
  warehouseId: string | null;
  /** True when the caller cannot widen it — an agent standing in one building. */
  pinned: boolean;
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

  if (input.actor.role !== "warehouse_agent") {
    return { warehouseId: requested, pinned: false };
  }

  const { data } = await supabase
    .from("users")
    .select("warehouse_id")
    .eq("id", input.actor.id)
    .maybeSingle<{ warehouse_id: string | null }>();

  const own = data?.warehouse_id ?? null;
  // An agent nobody has assigned yet sees the whole market. An empty bench
  // would read as a broken app, and the RPCs refuse the wrong site anyway.
  return own ? { warehouseId: own, pinned: true } : { warehouseId: null, pinned: false };
}
