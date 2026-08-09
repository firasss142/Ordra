import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDeliverySaving, type SavingRateRow } from "./delivery-saving";

/**
 * Snapshot what routing this order to its carrier account was worth, right
 * after a successful dispatch.
 *
 * BEST-EFFORT, ALWAYS. By the time this runs the shipment already exists at the
 * carrier and the order is recorded as dispatched. Nothing in here may throw or
 * surface an error — a bookkeeping miss must never make a successful dispatch
 * look like a failure to the agent. Every path resolves to undefined.
 *
 * NOT MEASURABLE IS LEFT NULL. If the destination was never quoted for one of
 * the accounts, or there is no alternative account, nothing is written at all.
 * A 0 would be indistinguishable from a genuine tie and would dilute the KPI.
 */

export interface RecordDeliverySavingInput {
  orderId: string;
  carrierId: string;
  carrierCode: string;
  marketId: string;
  /** The merged carrier_extra written to the order — carries city + area. */
  extra: Record<string, unknown> | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function recordDeliverySaving(
  admin: SupabaseClient,
  input: RecordDeliverySavingInput,
): Promise<void> {
  // Only a carrier with more than one account per market has a counterfactual.
  if (input.carrierCode !== "darb_assabil") return;

  const city = str(input.extra?.city);
  // The adapter's key for the destination sub-area; every dispatch path sets it.
  const area = str(input.extra?.customer_area);
  if (!city || !area) return;

  try {
    // One round trip: rates for this destination, restricted to active accounts
    // in the order's own market via an inner join on carriers.
    const { data, error } = await admin
      .from("darb_shipping_rates")
      .select("carrier_id, shipping_amount, carriers!inner(market_id, is_active)")
      .eq("city", city)
      .eq("area", area)
      .eq("carriers.market_id", input.marketId)
      .eq("carriers.is_active", true);
    if (error) return;

    const rates = (data ?? []) as unknown as SavingRateRow[];
    const saving = computeDeliverySaving({
      chosenCarrierId: input.carrierId,
      rates,
    });
    if (!saving) return;

    await admin
      .from("orders")
      .update({
        delivery_saving_lyd: saving.saving,
        delivery_cost_quoted: saving.chosenCost,
        delivery_saving_at: new Date().toISOString(),
      })
      .eq("id", input.orderId);
  } catch {
    // Deliberately silent — see the contract above.
  }
}
