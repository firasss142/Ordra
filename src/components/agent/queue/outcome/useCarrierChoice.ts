"use client";

/**
 * The send / schedule step's carrier cards: the market's active accounts, each with the
 * destination's quoted fee, the 30-day delivery rate and the median transit, ranked into
 * « meilleur choix » by compareCarriers — the same rule as the old post-call sheet, the
 * manager's upload sheet and the schedule modal. Fetched only while the step is open.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { coverageFor, type CoverageState } from "@/lib/carriers/coverage";
import { useCarrierRates } from "@/hooks/useCarrierRates";
import { destinationKey } from "@/lib/carriers/destination-key";
import { useResetOnDestinationChange } from "@/hooks/useResetOnDestinationChange";
import { useCarrierPerformance } from "@/hooks/useCarrierPerformance";
import { pickInitialCarrier } from "@/lib/carriers/initial-carrier-selection";
import { compareCarriers } from "@/lib/carriers/carrier-comparison";

interface CarrierOption {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export interface OrderForUpload {
  customer_address: string | null;
  customer_city: string | null;
  dexpress_state_id: number | null;
  darb_destination_id: number | null;
  total_price: number;
}

export interface CarrierCard {
  id: string;
  name: string;
  code: string;
  best: boolean;
  cost: number | null;
  deliveryRate: number | null;
  transitHours: number | null;
  coverage: CoverageState;
}

export function useCarrierChoice({ orderId, marketId, enabled }: { orderId: string; marketId: string | null; enabled: boolean }) {
  const { data: carriersData } = useSWR<{ data: CarrierOption[] }>(
    enabled && marketId ? `/api/carriers?market_id=${marketId}&is_active=true` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const active = (Array.isArray(carriersData?.data) ? carriersData.data : []).filter((c) => c.is_active);

  // The same key as the panel's own order: SWR serves it from the cache.
  const { data: orderData } = useSWR<{ data: OrderForUpload }>(enabled ? `/api/orders/${orderId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
  const order = orderData?.data ?? null;

  const dest = destinationKey(order);
  const { ratesByCarrierId } = useCarrierRates(orderId, enabled, dest);
  const { performanceByCarrierId } = useCarrierPerformance(marketId, enabled);

  const [selected, setSelected] = useState<string | null>(null);
  // A new address can move « meilleur choix »: Libya's two Darb accounts swap by geography.
  useResetOnDestinationChange(dest, () => setSelected(null));

  const coverage = coverageFor(order?.customer_city ?? null, order?.dexpress_state_id ?? null, order?.darb_destination_id ?? null);
  const coverageOf = (code: string): CoverageState =>
    code === "dexpress" ? coverage.dexpress : code === "darb_assabil" ? coverage.darb_assabil : "covered";

  const comparison = compareCarriers(
    active.map((c) => ({
      carrierId: c.id,
      cost: ratesByCarrierId[c.id]?.quotedFee ?? null,
      deliveryRate: performanceByCarrierId[c.id]?.deliveryRate30d ?? null,
      transitHours: performanceByCarrierId[c.id]?.medianTransitHours ?? null,
    })),
  );
  const rowOf = new Map(comparison.rows.map((r) => [r.carrierId, r]));

  // The agent's own pick wins; otherwise « meilleur choix », else the only carrier.
  const activeIds = active.map((c) => c.id).join(",");
  useEffect(() => {
    if (!enabled) return;
    const next = pickInitialCarrier({ carriers: active, coverageOf, recommendedCarrierId: comparison.bestChoiceCarrierId, currentSelection: selected });
    if (next !== null && next !== selected) setSelected(next);
    // coverageOf and active derive from the deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeIds, selected, order, comparison.bestChoiceCarrierId]);

  const cards: CarrierCard[] = active.map((c) => {
    const r = rowOf.get(c.id);
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      best: r?.isBestChoice ?? false,
      cost: r?.cost ?? null,
      deliveryRate: r?.deliveryRate ?? null,
      transitHours: r?.transitHours ?? null,
      coverage: coverageOf(c.code),
    };
  });

  return {
    loading: enabled && !carriersData,
    cards,
    selected,
    select: setSelected,
    selectedCard: cards.find((c) => c.id === selected) ?? null,
    order,
  };
}

export type CarrierChoice = ReturnType<typeof useCarrierChoice>;
