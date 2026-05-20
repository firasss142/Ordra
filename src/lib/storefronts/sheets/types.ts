import type { InternalOrderData } from "@/lib/storefronts/types";

/**
 * Maps a single Google Sheets row (column headers as keys, all values as
 * strings) to InternalOrderData.
 *
 * Throws PayloadMappingError on unrecoverable data issues — same contract as
 * StorefrontAdapter.mapToInternalOrder.
 */
export interface SheetsRowAdapter {
  readonly platform: string;
  mapRow(row: Record<string, string>): InternalOrderData;
}
