import type { SupabaseClient } from "@supabase/supabase-js";

export type SyncStateMap = Record<string, { last_row: number }>;

export async function getSyncState(
  adminClient: SupabaseClient,
  marketId: string
): Promise<SyncStateMap> {
  const { data } = await adminClient
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", "google_sheets_sync_state")
    .maybeSingle();

  return (data?.value as SyncStateMap) ?? {};
}

export async function setSyncState(
  adminClient: SupabaseClient,
  marketId: string,
  state: SyncStateMap
): Promise<void> {
  await adminClient.from("settings").upsert(
    {
      market_id: marketId,
      key: "google_sheets_sync_state",
      value: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "market_id,key" }
  );
}

export async function getLastRowForStorefront(
  adminClient: SupabaseClient,
  marketId: string,
  storefrontId: string
): Promise<number> {
  const state = await getSyncState(adminClient, marketId);
  return state[storefrontId]?.last_row ?? 0;
}

/** PostgREST / Postgres codes for "this function does not exist (yet)". */
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

/**
 * Move one sheet's cursor.
 *
 * Through `set_sheet_cursor`, which jsonb_sets one key inside the UPDATE. The
 * old read-modify-write of the whole object let a sync on account A write back
 * a copy taken before account B was connected, erasing B's starting row — B's
 * next tick then imported its entire history as new orders.
 *
 * The fallback exists only for the window between a deploy and the migration
 * being applied; any other error throws, because a cursor that silently does
 * not move is exactly how the sync once stalled for four days.
 */
export async function setLastRowForStorefront(
  adminClient: SupabaseClient,
  marketId: string,
  storefrontId: string,
  lastRow: number
): Promise<void> {
  const { error } = await adminClient.rpc("set_sheet_cursor", {
    p_market_id: marketId,
    p_storefront_id: storefrontId,
    p_last_row: lastRow,
  });
  if (!error) return;
  if (!FUNCTION_MISSING.has((error as { code?: string }).code ?? "")) {
    throw new Error(`Could not save the sheet cursor: ${(error as { message?: string }).message ?? "unknown error"}`);
  }
  const state = await getSyncState(adminClient, marketId);
  state[storefrontId] = { last_row: lastRow };
  await setSyncState(adminClient, marketId, state);
}
