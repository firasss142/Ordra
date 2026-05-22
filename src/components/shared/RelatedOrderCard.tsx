import type { ReactNode } from "react";
import { Copy, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { statusToneClass } from "@/lib/order-status-tone";
import { ProductAvatar } from "@/components/orders/ProductAvatar";

export interface RelatedOrderCardProps {
  /** Order UUID — used for the fallback "#abc123" label. */
  id: string;
  externalId: string | null;
  status: string;
  /** Already-translated status label (caller passes tStatuses(status)). */
  statusLabel: string;
  createdAt: string;
  totalPrice: number;
  /** Display currency code: "LBY" | "TND". */
  currencyCode: string;
  locale: string;
  /** Product name + thumbnail for the card's leading visual. */
  productName: string | null;
  productImageUrl: string | null;
  /** Highlights the current/anchor order with a stronger fill. */
  isAnchor?: boolean;
  /** Shows the duplicate-indicator icon (two-papers) next to the order number. */
  isDuplicate?: boolean;
  /** aria/title for the duplicate marker (required when isDuplicate). */
  duplicateMarkLabel?: string;
  /** Red chip warning the order is already committed to the carrier. */
  alreadyShipped?: boolean;
  /** Already-translated "already shipped" label. */
  shippedLabel?: string;
  /** Trailing action (e.g. the delete button), pinned to the bottom row. */
  rightSlot?: ReactNode;
}

/**
 * One related-order card in the duplicate / repeat-buyer popovers. The layout
 * mirrors the reference design: order number + muted date top-start with the
 * product thumbnail top-end, then the status pill (start) and price (end) on
 * the bottom row. Every card carries the dashed violet border; the anchor
 * (current) order gets a slightly stronger fill to stand out.
 */
export function RelatedOrderCard({
  id,
  externalId,
  status,
  statusLabel,
  createdAt,
  totalPrice,
  currencyCode,
  locale,
  productName,
  productImageUrl,
  isAnchor = false,
  isDuplicate = false,
  duplicateMarkLabel,
  alreadyShipped = false,
  shippedLabel,
  rightSlot,
}: RelatedOrderCardProps) {
  return (
    <div
      data-related-order
      data-anchor={isAnchor ? "true" : undefined}
      className={[
        "rounded-lg border border-dashed border-[#C9BCF5] p-3 transition-shadow hover:shadow-hover-row",
        isAnchor ? "bg-[#F4F1FE]" : "bg-[#FAF9FE]",
      ].join(" ")}
    >
      {/* Top row: order # + date (start), product image (end) */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold tabular-nums text-ink-primary">
              #{externalId ?? id.slice(0, 6)}
            </span>
            {isDuplicate && (
              <span
                data-duplicate-mark
                aria-label={duplicateMarkLabel}
                title={duplicateMarkLabel}
                className="inline-flex items-center text-ink-muted"
              >
                <Copy size={12} strokeWidth={2.25} aria-hidden="true" />
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-secondary">
            {formatDateTime(createdAt, locale)}
          </div>
        </div>
        <ProductAvatar
          imageUrl={productImageUrl}
          productName={productName ?? "?"}
          size={44}
        />
      </div>

      {/* Already-shipped warning chip */}
      {alreadyShipped && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-pill bg-status-criticalBg px-1.5 py-[1px] text-[11px] font-semibold text-status-critical">
          <AlertTriangle size={10} strokeWidth={2.25} aria-hidden="true" />
          {shippedLabel}
        </div>
      )}

      {/* Bottom row: status pill + trailing action (start) · price (end) */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={[
              "rounded-pill px-2 py-0.5 text-[12px] font-medium",
              statusToneClass(status),
            ].join(" ")}
          >
            {statusLabel}
          </span>
          {rightSlot}
        </div>
        <span className="shrink-0">
          <span className="text-[15px] font-semibold tabular-nums text-ink-primary">
            {totalPrice.toFixed(2)}
          </span>
          <span className="ms-1 text-[11px] font-medium text-ink-secondary">
            {currencyCode}
          </span>
        </span>
      </div>
    </div>
  );
}
