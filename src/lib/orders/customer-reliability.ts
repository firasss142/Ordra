import type { CustomerHistoryStats } from "@/hooks/useCustomerHistory";

export type CustomerReliability = "unknown" | "reliable" | "average" | "risky";

/**
 * Below this many orders there is no track record to read. One delivery out of
 * one does not make a reliable customer, it makes an unknown one, and a verdict
 * built on a single data point is worse than no verdict — an agent would act on
 * it.
 */
export const MIN_ORDERS_FOR_VERDICT = 3;

/** delivered / settled at or above this reads as reliable. */
export const RELIABLE_RATE = 0.85;
/** Below this it reads as risky; between the two, average. */
export const RISKY_RATE = 0.6;

/**
 * One-word verdict on a customer's delivery record.
 *
 * The rate is measured against *settled* orders — delivered plus returned —
 * rather than against every order the customer ever placed. An order still in
 * the pipeline has no outcome yet, and counting it as a failure would drag a
 * good customer down for the sole reason that they just ordered again.
 *
 * Rejections are deliberately outside the denominator: a refusal on the phone
 * costs an agent's minute, not a delivery, and the panel already shows the
 * attempt count for that.
 */
export function classifyCustomerReliability(
  stats: Pick<CustomerHistoryStats, "total_orders" | "delivered_count" | "returned_count"> | null,
): CustomerReliability {
  if (!stats) return "unknown";
  if (stats.total_orders < MIN_ORDERS_FOR_VERDICT) return "unknown";

  const settled = stats.delivered_count + stats.returned_count;
  if (settled <= 0) return "unknown";

  const rate = stats.delivered_count / settled;
  if (rate >= RELIABLE_RATE) return "reliable";
  if (rate < RISKY_RATE) return "risky";
  return "average";
}
