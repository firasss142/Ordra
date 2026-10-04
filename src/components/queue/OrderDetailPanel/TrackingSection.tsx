"use client";

import { useLocale, useTranslations } from "next-intl";
import { useWhen } from "@/components/orders/commandes/ui";
import { useOrderTimeline } from "@/hooks/useOrderTimeline";
import { presentStatus } from "@/lib/orders/status-presentation";
import { getStatusLabel } from "@/lib/status-labels";

/**
 * Where the parcel has got to, as the prototype's step list (`.tl` in the
 * Livraison pane): each stage reached, when, and how long it took — read from
 * `order_history` by /api/orders/[id]/timeline. The last step is where the
 * parcel is now and wears its status's hue.
 *
 * Renders nothing before the carrier has the order.
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
  marketId,
}: {
  orderId: string;
  status: string;
  marketId: string | null;
}) {
  const t = useTranslations("orders.detail");
  const tTl = useTranslations("orderTimeline");
  const locale = useLocale();
  const when = useWhen(marketId, locale);
  const enabled = TRACKED_STATUSES.has(status);
  const { timeline, isLoading } = useOrderTimeline(enabled ? orderId : null);

  if (!enabled) return null;

  const stages = timeline?.stages ?? [];
  return (
    <section aria-label={t("trackingTitle")}>
      <h3 className="odp-h">{t("trackingTitle")}</h3>
      {isLoading || !timeline ? (
        <div role="status" aria-label={t("trackingTitle")} className="tl-empty">
          {t("loading")}
        </div>
      ) : (
        <ul className="tl">
          {stages.map((s, i) => {
            const last = i === stages.length - 1;
            const label = getStatusLabel(s.status, locale === "ar" ? "ar" : "fr");
            const dur =
              s.duration_hours == null
                ? null
                : s.duration_hours < 1
                  ? tTl("under1h")
                  : s.duration_hours < 48
                    ? tTl("hours", { h: s.duration_hours })
                    : tTl("days", { d: Math.round((s.duration_hours / 24) * 10) / 10 });
            return (
              <li key={`${s.status}-${s.at}`} className={`h-${last ? presentStatus(s.status).hue : "neutral"}${last ? " now" : ""}`}>
                <time dateTime={s.at}>
                  {when(s.at)}
                  {dur ? ` · ${dur}` : ""}
                </time>
                {label}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
