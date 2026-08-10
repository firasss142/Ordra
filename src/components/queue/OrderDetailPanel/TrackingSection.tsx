"use client";

import { useTranslations } from "next-intl";
import { Route } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { OrderTimeline } from "@/components/in-delivery/OrderTimeline";
import { useOrderTimeline } from "@/hooks/useOrderTimeline";
import { Skeleton } from "@/components/ui/Skeleton";
import type { OrderStatus } from "@/types/order-status";

/**
 * Where the parcel is, inside the panel that opens on every order.
 *
 * The delivery tab had no OMS-side tracking at all — only the two carrier
 * widgets, which say whatever the carrier portal last said and nothing about how
 * long each leg took. `OrderTimeline` and `/api/orders/[id]/timeline` already
 * computed exactly this from `order_history`, and were used on one manager-only
 * page that agents cannot reach.
 *
 * Renders nothing before the carrier has the order: a four-node rail with every
 * node hollow tells you less than no rail at all, and would push the carrier
 * blocks below the fold on every pending order.
 */

/** Tracking starts once the order is with the carrier. */
const TRACKED_STATUSES = new Set<string>([
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "unverified",
  "to_be_returned",
  "received",
  "delivered",
  "returned",
]);

export function TrackingSection({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const t = useTranslations("orders.detail");
  const enabled = TRACKED_STATUSES.has(status);
  const { timeline, isLoading } = useOrderTimeline(enabled ? orderId : null);

  if (!enabled) return null;

  return (
    <SectionCard title={t("trackingTitle")} icon={Route}>
      {isLoading || !timeline ? (
        <div role="status" aria-label={t("trackingTitle")} className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 flex-1" />
          ))}
        </div>
      ) : (
        <OrderTimeline
          stages={timeline.stages}
          currentStatus={status as OrderStatus}
        />
      )}
    </SectionCard>
  );
}
