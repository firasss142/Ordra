import type { OrderStatus } from "@/types/order-status";

export type PreviewDirection = "expand" | "shrink" | "noop";

export interface PreviewOrder {
  id: string;
  status: OrderStatus;
  attempt_count: number;
}

export interface MaxAttemptsPreview {
  direction: PreviewDirection;
  affectedCount: number;
}

const ACTIVE_CONFIRMATION_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
]);

/**
 * Preview the effect of changing max_call_attempts.
 *
 * expand (next > current): previously auto-rejected orders that would now
 * fall within the reachable window — i.e. orders with status="rejected"
 * and attempt_count < next.
 *
 * shrink (next < current): currently active pre-dispatch orders whose
 * attempt_count already meets or exceeds the new ceiling and would be
 * auto-rejected going forward.
 */
export function previewMaxAttemptsChange(params: {
  current: number;
  next: number;
  orders: ReadonlyArray<PreviewOrder>;
}): MaxAttemptsPreview {
  const { current, next, orders } = params;

  if (current === next) {
    return { direction: "noop", affectedCount: 0 };
  }

  if (next > current) {
    const count = orders.filter(
      (o) => o.status === "rejected" && o.attempt_count < next,
    ).length;
    return { direction: "expand", affectedCount: count };
  }

  const count = orders.filter(
    (o) =>
      ACTIVE_CONFIRMATION_STATUSES.has(o.status) && o.attempt_count >= next,
  ).length;
  return { direction: "shrink", affectedCount: count };
}
