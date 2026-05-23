"use client";

import { useState, useRef, useId, useLayoutEffect, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { Layers, AlertTriangle, Trash2 } from "lucide-react";
import { canDeleteDuplicateSiblingStatus } from "@/lib/order-permissions";
import { RelatedOrderCard } from "@/components/shared/RelatedOrderCard";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

export interface DuplicateOrderBadgeProps {
  count: number;
  siblings: SiblingOrder[];
  hasUploadedSibling: boolean;
  /** The order this popover is opened from — the server re-verifies siblings against it. */
  anchorOrderId: string;
  /** Anchor order's own details — rendered as the first (violet) card in the group. */
  anchorStatus: string;
  anchorCreatedAt: string;
  anchorTotalPrice: number;
  anchorProductName: string | null;
  anchorProductImageUrl: string | null;
  anchorCustomerName: string | null;
  anchorCustomerAddress: string | null;
  anchorCustomerCity: string | null;
  /** Display currency code: "LBY" | "TND". */
  currencyCode: string;
  /** UX affordance for showing the per-sibling delete button (server is the real gate). */
  canDelete?: boolean;
  /** Called after a successful delete so the parent can revalidate its data. */
  onChange?: () => void;
  locale?: string;
}

/**
 * Marks an order that looks like a DUPLICATE of another (same customer +
 * product + quantity within 24h). The marker is icon-only (Layers) — no text.
 * HOVER opens a floating popover that shows the whole duplicate group as stacked
 * cards: the current order first (violet tint), then its siblings, each with
 * status + price, and a delete affordance for permitted roles. Distinct from
 * RepeatBuyerBadge (recurrent customer).
 */
export function DuplicateOrderBadge({
  count,
  siblings,
  hasUploadedSibling,
  anchorOrderId,
  anchorStatus,
  anchorCreatedAt,
  anchorTotalPrice,
  anchorProductName,
  anchorProductImageUrl,
  anchorCustomerName,
  anchorCustomerAddress,
  anchorCustomerCity,
  currencyCode,
  canDelete = false,
  onChange,
}: DuplicateOrderBadgeProps) {
  const t = useTranslations("duplicateOrder");
  const locale = useLocale();
  const popoverId = useId();

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  if (count === 0) return null;

  function handleEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function handleLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-duplicate="true"
        data-has-shipped={hasUploadedSibling ? "true" : undefined}
        aria-haspopup="dialog"
        aria-describedby={open ? popoverId : undefined}
        aria-label={t("trigger.aria", { count })}
        className={[
          "relative inline-flex items-center justify-center",
          "h-5 w-5 rounded-md",
          "text-status-warning hover:bg-status-warningBg",
          "ring-1 transition-colors",
          hasUploadedSibling ? "ring-status-critical/50" : "ring-status-warning/40",
        ].join(" ")}
      >
        <Layers size={12} strokeWidth={2.25} aria-hidden="true" />
        {count > 1 && (
          <span
            aria-hidden="true"
            className={[
              "absolute -top-1.5 -inline-end-1.5 min-w-[14px] rounded-full px-1",
              "text-[9px] font-bold leading-[14px] text-white",
              hasUploadedSibling ? "bg-status-critical" : "bg-status-warning",
            ].join(" ")}
            style={{ insetInlineEnd: "-6px" }}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <DuplicatePopover
          id={popoverId}
          anchorRef={triggerRef}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          siblings={siblings}
          locale={locale}
          currencyCode={currencyCode}
          anchorOrderId={anchorOrderId}
          anchorStatus={anchorStatus}
          anchorCreatedAt={anchorCreatedAt}
          anchorTotalPrice={anchorTotalPrice}
          anchorProductName={anchorProductName}
          anchorProductImageUrl={anchorProductImageUrl}
          anchorCustomerName={anchorCustomerName}
          anchorCustomerAddress={anchorCustomerAddress}
          anchorCustomerCity={anchorCustomerCity}
          canDelete={canDelete}
          onChange={onChange}
        />
      )}
    </span>
  );
}

interface DuplicatePopoverProps {
  id: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  siblings: SiblingOrder[];
  locale: string;
  currencyCode: string;
  anchorOrderId: string;
  anchorStatus: string;
  anchorCreatedAt: string;
  anchorTotalPrice: number;
  anchorProductName: string | null;
  anchorProductImageUrl: string | null;
  anchorCustomerName: string | null;
  anchorCustomerAddress: string | null;
  anchorCustomerCity: string | null;
  canDelete: boolean;
  onChange?: () => void;
}

const POPOVER_WIDTH = 340;
const VIEWPORT_GUTTER = 8;
const MIN_SPACE_BELOW = 180;

function DuplicatePopover({
  id,
  anchorRef,
  onMouseEnter,
  onMouseLeave,
  siblings,
  locale,
  currencyCode,
  anchorOrderId,
  anchorStatus,
  anchorCreatedAt,
  anchorTotalPrice,
  anchorProductName,
  anchorProductImageUrl,
  anchorCustomerName,
  anchorCustomerAddress,
  anchorCustomerCity,
  canDelete,
  onChange,
}: DuplicatePopoverProps) {
  const t = useTranslations("duplicateOrder.dialog");
  const tPop = useTranslations("duplicateOrder.popover");
  const tStatuses = useTranslations("orders.statuses");
  const isRtl = locale === "ar";

  // Local copy so a delete removes the row immediately (optimistic).
  const [rows, setRows] = useState<SiblingOrder[]>(siblings);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; maxHeight: number; openAbove: boolean } | null>(null);

  useEffect(() => {
    setRows(siblings);
  }, [siblings]);

  // Merge the anchor + siblings into one date-sorted list (newest first). The
  // anchor stays in its natural date position and is flagged with isAnchor so
  // the card renders with the violet accent regardless of position.
  type Entry =
    | { kind: "anchor"; createdAt: string }
    | { kind: "sibling"; createdAt: string; sibling: SiblingOrder };
  const mergedEntries = useMemo<Entry[]>(() => {
    const entries: Entry[] = [
      { kind: "anchor", createdAt: anchorCreatedAt },
      ...rows.map((s) => ({ kind: "sibling" as const, createdAt: s.created_at, sibling: s })),
    ];
    return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [anchorCreatedAt, rows]);

  useLayoutEffect(() => {
    function reposition() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
      let left = isRtl ? rect.right - width : rect.left;
      left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(left, window.innerWidth - width - VIEWPORT_GUTTER),
      );
      const spaceBelow = vh - rect.bottom - VIEWPORT_GUTTER;
      const spaceAbove = rect.top - VIEWPORT_GUTTER;
      const openAbove = spaceBelow < MIN_SPACE_BELOW && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, (openAbove ? spaceAbove : spaceBelow) - 8);
      const top = openAbove ? rect.top : rect.bottom;
      setCoords({ top, left, maxHeight, openAbove });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchorRef, isRtl]);

  async function handleDelete(s: SiblingOrder) {
    if (busyId) return;
    if (!window.confirm(t("confirm"))) return;
    setBusyId(s.id);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${anchorOrderId}/delete-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sibling_id: s.id }),
      });
      if (!res.ok) {
        setError(t("error"));
        setBusyId(null);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== s.id));
      setBusyId(null);
      onChange?.();
    } catch {
      setError(t("error"));
      setBusyId(null);
    }
  }

  if (typeof document === "undefined" || coords === null) return null;

  return createPortal(
    // Outer wrapper is a transparent hover "bridge": flush against the trigger
    // (top: rect.bottom) with 4px top padding spanning the visual gap, so the
    // cursor never crosses dead space en route to the card. Paired with the
    // 250ms close delay, the popover stays open while you move into it.
    <div
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: coords.openAbove ? undefined : coords.top,
        bottom: coords.openAbove ? window.innerHeight - coords.top : undefined,
        left: coords.left,
        width: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2),
      }}
      className="z-[1000] pt-1"
    >
    <div
      className={[
        "rounded-lg border border-line-subtle bg-surface-card",
        "shadow-floating text-[13px] text-ink-primary",
      ].join(" ")}
    >
      <div className="border-b border-line-subtle p-3">
        <div
          id={`${id}-title`}
          className="flex items-center gap-1.5 font-semibold text-status-warning"
        >
          <AlertTriangle size={14} strokeWidth={2.25} aria-hidden="true" />
          {t("title")}
        </div>
        <div className="mt-0.5 text-[12px] text-ink-muted">{t("subtitle")}</div>
      </div>

      {error && (
        <div className="border-b border-line-subtle bg-status-criticalBg px-3 py-1.5 text-[12px] font-medium text-status-critical">
          {error}
        </div>
      )}

      <div className="space-y-2 overflow-y-auto p-3" style={{ maxHeight: coords.maxHeight - 72 }}>
        {mergedEntries.map((entry) =>
          entry.kind === "anchor" ? (
            <RelatedOrderCard
              key={anchorOrderId}
              id={anchorOrderId}
              status={anchorStatus}
              statusLabel={tStatuses(anchorStatus as Parameters<typeof tStatuses>[0])}
              createdAt={anchorCreatedAt}
              totalPrice={anchorTotalPrice}
              currencyCode={currencyCode}
              locale={locale}
              customerName={anchorCustomerName}
              customerAddress={anchorCustomerAddress}
              customerCity={anchorCustomerCity}
              productName={anchorProductName}
              productImageUrl={anchorProductImageUrl}
              unknownCustomerLabel={tPop("unknownCustomer")}
              isAnchor
              isDuplicate
              duplicateMarkLabel={tPop("duplicateMark")}
            />
          ) : (
            (() => {
              const s = entry.sibling;
              const deletable = canDelete && canDeleteDuplicateSiblingStatus(s.status);
              return (
                <RelatedOrderCard
                  key={s.id}
                  id={s.id}
                  status={s.status}
                  statusLabel={tStatuses(s.status as Parameters<typeof tStatuses>[0])}
                  createdAt={s.created_at}
                  totalPrice={s.total_price}
                  currencyCode={currencyCode}
                  locale={locale}
                  customerName={s.customer_name}
                  customerAddress={s.customer_address}
                  customerCity={s.customer_city}
                  productName={s.product_name}
                  productImageUrl={s.product_image_url}
                  unknownCustomerLabel={tPop("unknownCustomer")}
                  isDuplicate
                  duplicateMarkLabel={tPop("duplicateMark")}
                  alreadyShipped={s.already_shipped}
                  shippedLabel={tPop("shipped")}
                  rightSlot={
                    deletable ? (
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        aria-label={t("deleteAria", {
                          externalId: s.external_id ?? s.id.slice(0, 6),
                        })}
                        onClick={() => handleDelete(s)}
                        className={[
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                          "text-status-critical hover:bg-status-criticalBg",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                        ].join(" ")}
                      >
                        <Trash2 size={11} strokeWidth={2.25} aria-hidden="true" />
                        {busyId === s.id ? t("deleting") : t("delete")}
                      </button>
                    ) : undefined
                  }
                />
              );
            })()
          ),
        )}
      </div>
    </div>
    </div>,
    document.body,
  );
}
