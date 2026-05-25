import type { ReactNode } from "react";
import { Copy, AlertTriangle, MapPin } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { statusToneClass } from "@/lib/order-status-tone";
import { ProductAvatar } from "@/components/orders/ProductAvatar";

export interface RelatedOrderCardProps {
  /** Order UUID — kept for a stable React key upstream. */
  id: string;
  status: string;
  /** Already-translated status label (caller passes tStatuses(status)). */
  statusLabel: string;
  createdAt: string;
  /** Order total — pass `null` to hide the price block (e.g. for a lead anchor). */
  totalPrice: number | null;
  /** Display currency code: "LBY" | "TND". */
  currencyCode: string;
  locale: string;
  /** Customer identity — the card's headline (replaces the order reference). */
  customerName: string | null;
  customerAddress: string | null;
  customerCity: string | null;
  /** Product name + thumbnail for the card's leading visual. */
  productName: string | null;
  productImageUrl: string | null;
  /** Highlights the current/anchor order with a stronger fill. */
  isAnchor?: boolean;
  /** Shows the duplicate-indicator icon (two-papers) next to the name. */
  isDuplicate?: boolean;
  /** aria/title for the duplicate marker (required when isDuplicate). */
  duplicateMarkLabel?: string;
  /** Red chip warning the order is already committed to the carrier. */
  alreadyShipped?: boolean;
  /** Already-translated "already shipped" label. */
  shippedLabel?: string;
  /** Fallback shown when the customer name is missing. */
  unknownCustomerLabel?: string;
  /** Trailing action (e.g. the delete button), pinned to the bottom row. */
  rightSlot?: ReactNode;
}

/** Joins address + city into a single line, or a dash when both are absent. */
function formatAddress(address: string | null, city: string | null): string {
  const parts = [address?.trim(), city?.trim()].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * One related-order card in the duplicate / repeat-buyer popovers. The headline
 * is the customer's name (with the duplicate marker), then the muted order date,
 * then the delivery address, with the product thumbnail top-end and the status
 * pill (start) / price (end) on the bottom row. Every card carries the dashed
 * violet border; the anchor (current) order gets a slightly stronger fill.
 */
export function RelatedOrderCard({
  id,
  status,
  statusLabel,
  createdAt,
  totalPrice,
  currencyCode,
  locale,
  customerName,
  customerAddress,
  customerCity,
  productName,
  productImageUrl,
  isAnchor = false,
  isDuplicate = false,
  duplicateMarkLabel,
  alreadyShipped = false,
  shippedLabel,
  unknownCustomerLabel,
  rightSlot,
}: RelatedOrderCardProps) {
  const address = formatAddress(customerAddress, customerCity);
  void id;

  return (
    <div
      data-related-order
      data-anchor={isAnchor ? "true" : undefined}
      className={[
        "relative overflow-hidden rounded-lg border border-dashed border-[#C9BCF5] p-3 transition-shadow hover:shadow-hover-row",
        isAnchor ? "bg-[#F4F1FE]" : "bg-[#FAF9FE]",
      ].join(" ")}
    >
      {isAnchor && (
        <span
          aria-hidden="true"
          data-anchor-accent
          className="pointer-events-none absolute inset-y-0 start-0 w-1 bg-[#7C3AED]"
        />
      )}
      {/* Top row: name + date (start), product image (end) */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-ink-primary">
              {customerName?.trim() || unknownCustomerLabel || "—"}
            </span>
            {isDuplicate && (
              <span
                data-duplicate-mark
                aria-label={duplicateMarkLabel}
                title={duplicateMarkLabel}
                className="inline-flex shrink-0 items-center text-ink-muted"
              >
                <Copy size={12} strokeWidth={2.25} aria-hidden="true" />
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-secondary">
            {formatDateTime(createdAt, locale)}
          </div>
          {/* Address line */}
          <div
            className="mt-1 flex items-center gap-1 text-[12px] text-ink-muted"
            title={address}
          >
            <MapPin size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{address}</span>
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
        {totalPrice !== null && (
          <span className="shrink-0">
            <span className="text-[15px] font-semibold tabular-nums text-ink-primary">
              {totalPrice.toFixed(2)}
            </span>
            <span className="ms-1 text-[11px] font-medium text-ink-secondary">
              {currencyCode}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
