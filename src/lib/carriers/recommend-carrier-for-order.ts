import type { SupabaseClient } from "@supabase/supabase-js";
import { marketIdToCode } from "@/lib/markets";
import {
  carrierCostSums,
  realCostPerDelivered,
} from "@/lib/calculations/carrier-true-cost";
import { pickRateForOrder, type DarbRateRow } from "./darb-rate-lookup";
import {
  recommendCarrierByRate,
  type CarrierRateCandidate,
  type RankedCandidate,
  type RecommendationReason,
} from "./darb-rate-recommendation";

/**
 * IO wrapper around the pure recommendation core: load this destination's
 * harvested rates plus each account's historical true cost, then rank.
 *
 * FAILURE IS ALWAYS SOFT. Every path returns { none } rather than throwing.
 * This runs on the webhook intake path, and an order that arrives without a
 * recommendation is fine — an order that does not arrive is a lost sale.
 */

const NONE: RecommendCarrierResult = { carrier_id: null, reason: "none", ranked: [] };

export interface RecommendCarrierParams {
  market_id: string;
  /** The resolved canonical Darb city, not the raw storefront string. */
  city: string | null;
  /** null when the area is not decided yet (multi-area city). */
  area: string | null;
  /** Days of history behind the true-cost tie-break. */
  historyDays?: number;
}

export interface RecommendCarrierResult {
  carrier_id: string | null;
  reason: RecommendationReason;
  ranked: RankedCandidate[];
}

interface CarrierRow {
  id: string;
  name: string;
  code: string;
  delivery_fee: number | null;
  return_fee: number | null;
}

interface TrueCostRow {
  carrier_id: string;
  delivered: number;
  returned: number;
  delivery_cost: number;
  return_cost: number;
}

export async function recommendCarrierForOrder(
  adminClient: SupabaseClient,
  params: RecommendCarrierParams,
): Promise<RecommendCarrierResult> {
  // Only Libya prices by destination; Tunisia's carriers are genuinely flat.
  // Short-circuit before any round trip.
  if (marketIdToCode(params.market_id) !== "ly") return NONE;
  if (!params.city) return NONE;

  try {
    // Ordered by id so an all-equal tie resolves stably and the badge never
    // flickers between two identical options across refetches.
    const { data: carrierData, error: carrierError } = await adminClient
      .from("carriers")
      .select("id, name, code, delivery_fee, return_fee")
      .eq("market_id", params.market_id)
      .eq("is_active", true)
      .order("id", { ascending: true });
    if (carrierError) return NONE;

    const carriers = ((carrierData ?? []) as CarrierRow[]).filter(
      (c) => c.code === "darb_assabil",
    );
    if (carriers.length === 0) return NONE;

    const { data: rateData } = await adminClient
      .from("darb_shipping_rates")
      .select("carrier_id, city, area, shipping_amount, currency, last_success_at")
      .eq("city", params.city)
      .in(
        "carrier_id",
        carriers.map((c) => c.id),
      );
    const rates = (rateData ?? []) as DarbRateRow[];

    // The tie-break. A failing RPC must not sink the whole recommendation —
    // without history we simply rank on quotes alone.
    let trueCosts: TrueCostRow[] = [];
    const { data: costData, error: costError } = await adminClient.rpc(
      "get_carrier_true_cost",
      { p_market_id: params.market_id, p_days: params.historyDays ?? 90 },
    );
    if (!costError && Array.isArray(costData)) trueCosts = costData as TrueCostRow[];

    const candidates: CarrierRateCandidate[] = carriers.map((carrier) => {
      const rate = pickRateForOrder(
        rates,
        { city: params.city as string, area: params.area },
        carrier.id,
      );
      const history = trueCosts.find((t) => t.carrier_id === carrier.id);

      return {
        carrierId: carrier.id,
        carrierName: carrier.name,
        quotedFee: rate?.shipping_amount ?? null,
        quotedAt: rate?.last_success_at ?? null,
        trueCostPerDelivered: history
          ? realCostPerDelivered({
              delivered: Number(history.delivered),
              deliveryCost: Number(history.delivery_cost),
              returnCost: Number(history.return_cost),
            })
          : // No history rows yet — fall back to what the flat fees imply, so a
            // brand-new account still has a comparable number.
            realCostPerDelivered({
              delivered: 1,
              ...carrierCostSums({
                delivered: 1,
                returned: 0,
                deliveryFee: carrier.delivery_fee,
                returnFee: carrier.return_fee,
              }),
            }),
        stickerDeliveryFee: carrier.delivery_fee,
      };
    });

    const result = recommendCarrierByRate(candidates);
    return {
      carrier_id: result.recommendedCarrierId,
      reason: result.reason,
      ranked: result.ranked,
    };
  } catch {
    return NONE;
  }
}
