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
  /**
   * A reason to leave this row out entirely, or `null` to import it.
   *
   * Distinct from throwing PayloadMappingError: a skipped row is not an order
   * (the merchant deleted the checkout), so it is neither imported nor written
   * to the failed-rows table where it would sit forever as noise. The engine
   * still advances the cursor past it.
   */
  skipReason?(row: Record<string, string>): string | null;
}
