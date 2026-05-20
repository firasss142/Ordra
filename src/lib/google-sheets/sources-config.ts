import type { SupabaseClient } from "@supabase/supabase-js";
import type { SheetSyncConfig } from "./sync-engine";

export async function getSheetsSources(
  adminClient: SupabaseClient,
  marketId: string
): Promise<SheetSyncConfig[]> {
  const { data } = await adminClient
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", "google_sheets_sources")
    .maybeSingle();

  if (!Array.isArray(data?.value)) return [];

  return (data.value as SheetSyncConfig[]).filter(
    (s): s is SheetSyncConfig =>
      typeof s === "object" &&
      s !== null &&
      typeof s.storefront_id === "string" &&
      typeof s.spreadsheet_id === "string" &&
      typeof s.sheet_name === "string" &&
      typeof s.platform === "string"
  );
}
