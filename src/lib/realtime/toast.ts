import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";

/**
 * Statuses that should fire a realtime toast when an order transitions to them
 * while visible in another tab. Aligns with terminal statuses + DELETE.
 */
export type RealtimeTerminalKind =
  | "cancelled"
  | "rejected"
  | "delivered"
  | "returned"
  | "deleted";

interface OrderLike {
  external_id?: string | null;
  id: string;
}

function shortId(order: OrderLike): string {
  return order.external_id?.toString() ?? order.id.slice(0, 8);
}

/**
 * Returns a function that fires a localized toast for terminal/destructive
 * realtime transitions. Tone follows the kind:
 *  - delivered → info (positive outcome)
 *  - returned/cancelled → warning
 *  - rejected/deleted → critical
 */
export function useRealtimeToast() {
  const { show } = useToast();
  const t = useTranslations("realtime.toast");

  return useCallback(
    (order: OrderLike, kind: RealtimeTerminalKind) => {
      const message = t(kind, { id: shortId(order) });
      const tone =
        kind === "delivered"
          ? "info"
          : kind === "rejected" || kind === "deleted"
            ? "critical"
            : "warning";
      show({ message, tone, duration: 4000 });
    },
    [show, t],
  );
}
