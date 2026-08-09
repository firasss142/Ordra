"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import { marketIdToCode } from "@/lib/markets";
import { rateBadgeFor, type CarrierRateInfo } from "@/lib/carriers/rate-badge";

/**
 * The per-destination delivery price for one carrier account, rendered beside
 * its name in the carrier pickers.
 *
 * Shared by OrderDetailPanel's upload sheet and PostCallActionSheet's radio
 * list so both surfaces say the same thing. All the decisions live in the pure
 * rateBadgeFor(); this only paints them.
 *
 * Renders nothing when there is no price — never a 0, which would read as a
 * free delivery (Darb genuinely quotes 0 for some legs, so the two must stay
 * distinguishable).
 */
export function CarrierRateBadge({
  info,
  marketId,
}: {
  info: CarrierRateInfo | undefined;
  marketId: string | null | undefined;
}) {
  const t = useTranslations("dispatch.rates");
  const badge = rateBadgeFor(info);

  if (badge.amount == null) return null;

  const market = (marketIdToCode(marketId) ?? "ly").toUpperCase();

  return (
    <span
      className={[
        "text-[12px] tabular-nums",
        badge.tone === "cheapest" ? "font-medium text-status-success" : "text-ink-secondary",
        badge.stale ? "opacity-60" : "",
      ].join(" ")}
      title={badge.stale ? t("staleFee") : undefined}
    >
      {formatCurrency(badge.amount, market)}
      {badge.stale ? " *" : ""}
    </span>
  );
}

/** "Le moins cher" marker on the recommended account. */
export function CheapestPill() {
  const t = useTranslations("dispatch.rates");
  return (
    <span className="rounded-full bg-status-successBg px-1.5 py-0.5 text-[11px] font-medium text-status-success">
      {t("cheapest")}
    </span>
  );
}
