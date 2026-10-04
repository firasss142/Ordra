import type { SupabaseClient } from "@supabase/supabase-js";
import type { SheetSyncConfig } from "./sync-engine";

/**
 * Which sheets the import reads, one per storefront.
 *
 * THE STOREFRONT ROW IS THE SOURCE. A Converty account is a storefront whose
 * platform is `google_sheets` and whose `config` names its spreadsheet and tab:
 * two accounts are two storefronts, each with its own cursor, its own failed
 * rows and its own `(storefront_id, external_id)` dedupe namespace. Archiving
 * the storefront stops its import.
 *
 * It used to be the other way round. The sources lived in a separate
 * `settings.google_sheets_sources` list that nothing in the UI could write,
 * with no link back to `storefronts.is_active` — so archiving a sheet shop kept
 * importing it, and an entry pointing at no storefront failed every row on the
 * orders FK. That list is still read, but only as an OVERRIDE for a storefront
 * that exists: the live Libya sheet is configured there, and its storefront
 * row names a different tab. It can never create a source on its own.
 */

/** Default row format when a storefront's config does not name one. */
export const DEFAULT_SHEET_ADAPTER = "converty";

export interface SheetStorefrontRow {
  id: string;
  market_id: string;
  platform: string;
  is_active: boolean;
  config: unknown;
}

export interface LegacySheetSource {
  storefront_id?: unknown;
  spreadsheet_id?: unknown;
  sheet_name?: unknown;
  platform?: unknown;
  is_active?: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function mergeSheetSources(
  storefronts: SheetStorefrontRow[],
  legacy: LegacySheetSource[],
): SheetSyncConfig[] {
  const legacyById = new Map<string, LegacySheetSource>();
  for (const entry of legacy) {
    const id = str(entry?.storefront_id);
    // First entry wins: two entries for one storefront would walk one cursor.
    if (id && !legacyById.has(id)) legacyById.set(id, entry);
  }

  const out: SheetSyncConfig[] = [];
  const seen = new Set<string>();
  for (const s of storefronts) {
    if (s.platform !== "google_sheets" || !s.is_active || seen.has(s.id)) continue;
    seen.add(s.id);

    const config = (s.config && typeof s.config === "object" ? s.config : {}) as Record<string, unknown>;
    const override = legacyById.get(s.id);
    if (override && override.is_active === false) continue;

    const spreadsheetId = str(override?.spreadsheet_id) ?? str(config.spreadsheet_id);
    const sheetName = str(override?.sheet_name) ?? str(config.sheet_name);
    if (!spreadsheetId || !sheetName) continue;

    out.push({
      storefront_id: s.id,
      market_id: s.market_id,
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      platform: str(override?.platform) ?? str(config.sheet_adapter) ?? DEFAULT_SHEET_ADAPTER,
      is_active: true,
    });
  }
  return out;
}

/**
 * The list started at `turn`. Sources share one deadline per invocation, so a
 * fixed order lets the first account's backlog starve every account after it;
 * rotating the start each cron tick gives each one the head of the queue in turn.
 */
export function rotateSources<T>(sources: T[], turn: number): T[] {
  if (sources.length === 0) return [];
  const k = ((turn % sources.length) + sources.length) % sources.length;
  return [...sources.slice(k), ...sources.slice(0, k)];
}

/** The spreadsheet id from a pasted Google Sheets URL or a bare id, else null. */
export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
}

export async function getSheetsSources(
  adminClient: SupabaseClient,
  marketId: string,
): Promise<SheetSyncConfig[]> {
  const [storefrontsRes, legacyRes] = await Promise.all([
    adminClient
      .from("storefronts")
      .select("id, market_id, platform, is_active, config")
      .eq("market_id", marketId)
      .eq("platform", "google_sheets"),
    adminClient
      .from("settings")
      .select("value")
      .eq("market_id", marketId)
      .eq("key", "google_sheets_sources")
      .maybeSingle(),
  ]);

  const storefronts = (storefrontsRes.data ?? []) as SheetStorefrontRow[];
  const legacy = Array.isArray(legacyRes.data?.value) ? (legacyRes.data.value as LegacySheetSource[]) : [];
  return mergeSheetSources(storefronts, legacy);
}
