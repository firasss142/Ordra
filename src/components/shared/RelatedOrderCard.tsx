import type { ReactNode } from "react";
import { Copy, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { statusToneClass } from "@/lib/order-status-tone";

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
  /** Highlights the current/anchor order with the violet selection tint. */
  isAnchor?: boolean;
  /** Shows the duplicate-indicator icon (two-papers) in the top-end cluster. */
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
 * One related-order card in the duplicate / repeat-buyer popovers. Stacked
 * layout: order number on top, muted date below, a status pill + optional
 * duplicate marker top-end, and the price bottom-end. The anchor (current)
 * order gets a soft violet tint — the single sanctioned decorative-color
 * exception, used only to mark "this is the order you're looking at".
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
        "rounded-lg border p-3 transition-shadow hover:shadow-hover-row",
        isAnchor
          ? "border-[#C9BCF5] bg-[#F4F1FE]"
          : "border-line-subtle bg-surface-card",
      ].join(" ")}
    >
      {/* Top row: order # + status pill / duplicate marker */}
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-semibold tabular-nums text-ink-primary">
          #{externalId ?? id.slice(0, 6)}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={[
              "rounded-pill px-1.5 py-[1px] text-[11px] font-medium",
              statusToneClass(status),
            ].join(" ")}
          >
            {statusLabel}
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
      </div>

      {/* Date */}
      <div className="mt-0.5 text-[12px] text-ink-secondary">
        {formatDateTime(createdAt, locale)}
      </div>

      {/* Already-shipped warning chip */}
      {alreadyShipped && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-pill bg-status-criticalBg px-1.5 py-[1px] text-[11px] font-semibold text-status-critical">
          <AlertTriangle size={10} strokeWidth={2.25} aria-hidden="true" />
          {shippedLabel}
        </div>
      )}

      {/* Bottom row: trailing action (start) + price (end) */}
      <div className="mt-2 flex items-center justify-between gap-2">
        {rightSlot ?? <span />}
        <span className="ms-auto shrink-0">
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
