import { DEFAULT_SLA_MINUTES } from "@/types/settings";
import { useMarketNumberSetting } from "./useMarketNumberSetting";

/**
 * The market's confirmation target, in minutes.
 *
 * Falls back to the shipped default once the request has answered — a market
 * that never opened Réglages still has a policy, it is just the default one.
 * Returns `null` while the request is in flight, so the header shows no chip
 * rather than a target it is about to revise.
 */
export function useSlaMinutes(marketId: string | null): number | null {
  const { value, loaded } = useMarketNumberSetting(marketId, "sla_minutes");

  if (!loaded) return null;
  return value !== null && value > 0 ? value : DEFAULT_SLA_MINUTES;
}
