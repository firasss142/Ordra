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

export async function setLastRowForStorefront(
  adminClient: SupabaseClient,
  marketId: string,
  storefrontId: string,
  lastRow: number
): Promise<void> {
  const state = await getSyncState(adminClient, marketId);
  state[storefrontId] = { last_row: lastRow };
  await setSyncState(adminClient, marketId, state);
}
