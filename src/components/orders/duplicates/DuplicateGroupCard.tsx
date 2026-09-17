"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Eye, Clock } from "lucide-react";
import { RelatedOrderCard } from "@/components/shared/RelatedOrderCard";
import type { DuplicateGroup, DuplicateGroupMember } from "@/lib/duplicate-orders/groups";

export interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  /** Ids currently ticked, owned by the page. */
  selected: Set<string>;
  onToggle: (memberId: string) => void;
  currencyCode: string;
  locale: string;
  /** Agents see the screen but cannot act on it. */
  readOnly: boolean;
}

/** "20 min", "3 h 05", "2 j" — the gap that decides whether this is a duplicate. */
function formatSpan(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
  }
  return `${Math.floor(minutes / (60 * 24))} j`;
}

/**
 * One duplicate group: the order being kept, and the copies that may be removed.
 *
 * A member gets a checkbox only when it is neither the anchor nor already
 * committed to a carrier. That is deliberately stricter than the confidence
 * tier — a stale `deletable` flag can then only ever under-offer, never delete
 * a parcel that physically exists.
 */
export function DuplicateGroupCard({
  group,
  selected,
  onToggle,
  currencyCode,
  locale,
  readOnly,
}: DuplicateGroupCardProps) {
  const t = useTranslations("duplicateOrder.review");
  const tStatuses = useTranslations("orders.statuses");

  const isHigh = group.confidence === "high";
  const ConfidenceIcon = isHigh ? CheckCircle2 : Eye;

  const selectable = (m: DuplicateGroupMember) =>
    !readOnly && !m.is_anchor && m.deletable && !m.already_shipped;

  return (
    <section
      data-duplicate-group={group.key}
      data-confidence={group.confidence}
      className="rounded-xl border border-oms-border bg-oms-surface p-4"
    >
      {/* Header: confidence, size, elapsed gap, and any address divergence. */}
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {/* Colour never carries confidence alone — the glyph repeats it (§4.17 D). */}
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[12px] font-semibold",
            isHigh
              ? "bg-oms-ok-bg text-oms-ok"
              : "bg-oms-warn-bg text-oms-warn-ink",
          ].join(" ")}
        >
          <ConfidenceIcon size={12} strokeWidth={2.25} aria-hidden="true" />
          {isHigh ? t("chipHigh") : t("chipReview")}
        </span>

        <span className="text-[12px] tabular-nums text-oms-ink-3">
          {t("members", { count: group.members.length })}
        </span>

        <span className="inline-flex items-center gap-1 text-[12px] tabular-nums text-oms-ink-3">
          <Clock size={11} strokeWidth={2} aria-hidden="true" />
          {t("span", { span: formatSpan(group.span_minutes) })}
        </span>

        {!group.address_matches && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-oms-age-warm">
            <AlertTriangle size={12} strokeWidth={2.25} aria-hidden="true" />
            {t("addressDiffers")}
          </span>
        )}
        {!group.city_matches && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-oms-age-warm">
            <AlertTriangle size={12} strokeWidth={2.25} aria-hidden="true" />
            {t("cityDiffers")}
          </span>
        )}
      </header>

      <ul className="grid gap-2 md:grid-cols-2">
        {group.members.map((m) => {
          const canSelect = selectable(m);
          return (
            <li key={m.id}>
              <RelatedOrderCard
                id={m.id}
                status={m.status}
                statusLabel={tStatuses(m.status as Parameters<typeof tStatuses>[0])}
                createdAt={m.created_at}
                totalPrice={m.total_price}
                currencyCode={currencyCode}
                locale={locale}
                customerName={m.customer_name}
                customerAddress={m.customer_address}
                customerCity={m.customer_city}
                productName={m.product_name}
                productImageUrl={m.product_image_url}
                isAnchor={m.is_anchor}
                alreadyShipped={m.already_shipped}
                shippedLabel={t("shippedMember")}
                rightSlot={
                  m.is_anchor ? (
                    <span className="rounded-pill bg-brand-bg px-2 py-0.5 text-[11px] font-semibold text-brand">
                      {t("keep")}
                    </span>
                  ) : canSelect ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-oms-ink-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand align-middle"
                        aria-label={t("selectAria", {
                          externalId: m.external_id ?? m.id,
                        })}
                        checked={selected.has(m.id)}
                        onChange={() => onToggle(m.id)}
                      />
                    </label>
                  ) : !m.deletable && !m.already_shipped ? (
                    <span className="text-[11px] font-medium text-oms-ink-3">
                      {t("notDeletable")}
                    </span>
                  ) : null
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
