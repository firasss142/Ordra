"use client";

import { useState, useRef, useId, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { Star, AlertTriangle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { RelatedOrderCard } from "@/components/shared/RelatedOrderCard";
import { useCustomerHistory } from "@/hooks/useCustomerHistory";
import type { RepeatKind } from "@/lib/customer-history/classify";

export interface RepeatBuyerBadgeProps {
  source: "order" | "lead";
  sourceId: string;
  repeatKind: RepeatKind;
  priorOrderCount: number;
  priorLeadCount: number;
  priorRejectedCount: number;
  /** Display currency code: "LBY" | "TND" — rendered on each history card. */
  currencyCode: string;
  /** Optional: if provided and the source is an order, "See all orders" deep-links to filtered orders. */
  customerPhone?: string | null;
  locale?: string;
  /**
   * Hovered order/lead fields — rendered as a card in the popover so users see
   * the row they're on alongside its history. For leads (no price), pass
   * `anchorTotalPrice={null}` and `anchorProductName/Image={null}`.
   */
  anchorOrderId: string;
  anchorStatus: string;
  anchorCreatedAt: string;
  anchorTotalPrice: number | null;
  anchorProductName: string | null;
  anchorProductImageUrl: string | null;
  anchorCustomerName: string | null;
  anchorCustomerAddress: string | null;
  anchorCustomerCity: string | null;
}

const TONE_BY_KIND: Record<Exclude<RepeatKind, "none">, "action" | "neutral" | "critical"> = {
  repeat: "action",
  likely: "neutral",
  risk: "critical",
};

export function RepeatBuyerBadge(props: RepeatBuyerBadgeProps) {
  const {
    source,
    sourceId,
    repeatKind,
    priorOrderCount,
    priorLeadCount,
    priorRejectedCount,
  } = props;

  const t = useTranslations("customerHistory");
  const tStatuses = useTranslations("orders.statuses");
  const locale = useLocale();
  const popoverId = useId();

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  const { detail, isLoading, error } = useCustomerHistory(source, sourceId, open);

  if (repeatKind === "none") return null;

  const tone = TONE_BY_KIND[repeatKind];
  const label =
    repeatKind === "risk"
      ? t("badge.risk", { count: priorRejectedCount })
      : repeatKind === "likely"
        ? t("badge.likely", {
            count: Math.max(priorOrderCount, priorLeadCount),
          })
        : t("badge.repeat", { count: priorOrderCount });

  const Icon = repeatKind === "risk" ? AlertTriangle : Star;

  function handleEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function handleLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  }
  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={stop}
    >
      <Badge
        tone={tone}
        data-repeat-kind={repeatKind}
        aria-describedby={open ? popoverId : undefined}
        tabIndex={0}
        className={[
          "cursor-default select-none",
          repeatKind === "likely" ? "border border-dashed border-line-strong" : "",
        ].join(" ")}
      >
        <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
        {label}
      </Badge>
      {open && (
        <PopoverPanel
          id={popoverId}
          anchorRef={triggerRef}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          repeatKind={repeatKind}
          priorOrderCount={priorOrderCount}
          priorLeadCount={priorLeadCount}
          isLoading={isLoading}
          error={!!error}
          detail={detail}
          locale={locale}
          tStatuses={tStatuses}
          currencyCode={props.currencyCode}
          customerPhone={props.customerPhone ?? null}
          anchorOrderId={props.anchorOrderId}
          anchorStatus={props.anchorStatus}
          anchorCreatedAt={props.anchorCreatedAt}
          anchorTotalPrice={props.anchorTotalPrice}
          anchorProductName={props.anchorProductName}
          anchorProductImageUrl={props.anchorProductImageUrl}
          anchorCustomerName={props.anchorCustomerName}
          anchorCustomerAddress={props.anchorCustomerAddress}
          anchorCustomerCity={props.anchorCustomerCity}
        />
      )}
    </span>
  );
}

interface PopoverPanelProps {
  id: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  repeatKind: Exclude<RepeatKind, "none">;
  priorOrderCount: number;
  priorLeadCount: number;
  isLoading: boolean;
  error: boolean;
  detail: ReturnType<typeof useCustomerHistory>["detail"];
  locale: string;
  tStatuses: ReturnType<typeof useTranslations>;
  currencyCode: string;
  customerPhone: string | null;
  anchorOrderId: string;
  anchorStatus: string;
  anchorCreatedAt: string;
  anchorTotalPrice: number | null;
  anchorProductName: string | null;
  anchorProductImageUrl: string | null;
  anchorCustomerName: string | null;
  anchorCustomerAddress: string | null;
  anchorCustomerCity: string | null;
}

const POPOVER_WIDTH = 320;
const VIEWPORT_GUTTER = 8;

function PopoverPanel({
  id,
  anchorRef,
  onMouseEnter,
  onMouseLeave,
  repeatKind,
  priorOrderCount,
  priorLeadCount,
  isLoading,
  error,
  detail,
  locale,
  tStatuses,
  currencyCode,
  customerPhone,
  anchorOrderId,
  anchorStatus,
  anchorCreatedAt,
  anchorTotalPrice,
  anchorProductName,
  anchorProductImageUrl,
  anchorCustomerName,
  anchorCustomerAddress,
  anchorCustomerCity,
}: PopoverPanelProps) {
  const t = useTranslations("customerHistory.popover");
  const isRtl = locale === "ar";

  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    function reposition() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
      // Align the popover's inline-start edge with the trigger's inline-start
      // edge, then clamp so it never overflows the viewport horizontally.
      let left = isRtl ? rect.right - width : rect.left;
      left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(left, window.innerWidth - width - VIEWPORT_GUTTER),
      );
      setCoords({ top: rect.bottom, left });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchorRef, isRtl]);

  // Derive these BEFORE any conditional return so hook order stays stable.
  const stats = detail?.stats;
  const orders = detail?.orders ?? [];
  const leads = detail?.leads ?? [];

  // Merge the hovered row (anchor) into the customer history and sort by date
  // (newest first). The anchor renders with `isAnchor` so it stands out
  // regardless of its date position. Sliced to the same 6-card cap as before.
  type Entry =
    | { kind: "anchor"; createdAt: string }
    | { kind: "history"; createdAt: string; order: (typeof orders)[number] };
  const mergedEntries = useMemo<Entry[]>(() => {
    const entries: Entry[] = [
      { kind: "anchor", createdAt: anchorCreatedAt },
      ...orders.map((o) => ({ kind: "history" as const, createdAt: o.created_at, order: o })),
    ];
    return entries
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, 6);
  }, [anchorCreatedAt, orders]);

  if (typeof document === "undefined" || coords === null) return null;

  const headline =
    repeatKind === "risk" && stats
      ? t("headlineRisk", {
          rejected: stats.rejected_count,
          total: stats.total_orders,
        })
      : t("headlineRepeat", {
          count: stats?.total_orders ?? priorOrderCount,
          delivered: stats?.delivered_count ?? 0,
        });

  const seeAllHref = customerPhone
    ? `/${locale}/orders?q=${encodeURIComponent(customerPhone)}`
    : null;

  // Header count includes the hovered order in the merged list (N+1).
  const totalCount = (stats?.total_orders ?? priorOrderCount) + 1;

  return createPortal(
    // Outer wrapper is a transparent hover "bridge": it sits flush against the
    // trigger (top: rect.bottom) and its 4px top padding spans the visual gap,
    // so the cursor never crosses dead space on its way to the card. Paired with
    // the 250ms close delay, the popover stays open while you move into it.
    <div
      id={id}
      role="dialog"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2),
      }}
      className="z-[1000] pt-1"
    >
    <div
      className={[
        "rounded-lg border border-line-subtle bg-surface-card",
        "shadow-[0_8px_24px_rgba(0,0,0,0.10)] p-3",
        "text-[13px] text-ink-primary",
      ].join(" ")}
    >
      {isLoading && !detail && (
        <div className="text-ink-muted text-[12px]">{t("loading")}</div>
      )}
      {error && (
        <div className="text-status-critical text-[12px]">{t("error")}</div>
      )}
      {!isLoading && !error && detail && (
        <>
          {/* Header: total orders (start) + "see all" link (end) */}
          <div className="flex items-center justify-between gap-3 pb-2">
            <span
              className={[
                "font-semibold",
                repeatKind === "risk" ? "text-status-critical" : "text-ink-primary",
              ].join(" ")}
              title={headline}
            >
              {t("totalOrders", { count: totalCount })}
            </span>
            {seeAllHref && (
              <a
                href={seeAllHref}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex shrink-0 items-center gap-1 text-status-action hover:underline text-[12px]"
              >
                {t("seeAll")}
                <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />
              </a>
            )}
          </div>

          {/* Risk callout — kept for the rejection-warning case */}
          {repeatKind === "risk" && (
            <div className="mb-2 border-t border-line-subtle pt-2 text-[12px] font-medium text-status-critical">
              {headline}
            </div>
          )}

          <div className="border-t border-line-subtle pt-2.5 space-y-2.5 max-h-[320px] overflow-y-auto">
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
                  unknownCustomerLabel={t("unknownCustomer")}
                  isAnchor
                />
              ) : (
                <RelatedOrderCard
                  key={entry.order.id}
                  id={entry.order.id}
                  status={entry.order.status}
                  statusLabel={tStatuses(entry.order.status as Parameters<typeof tStatuses>[0])}
                  createdAt={entry.order.created_at}
                  totalPrice={Number(entry.order.total_price)}
                  currencyCode={currencyCode}
                  locale={locale}
                  customerName={entry.order.customer_name}
                  customerAddress={entry.order.customer_address}
                  customerCity={entry.order.customer_city}
                  productName={entry.order.product_name}
                  productImageUrl={entry.order.product_image_url}
                  unknownCustomerLabel={t("unknownCustomer")}
                />
              ),
            )}
          </div>

          {leads.length > 0 && (
            <div className="text-ink-muted text-[12px] mt-2">
              {t("plusLeads", { count: priorLeadCount || leads.length })}
            </div>
          )}
        </>
      )}
    </div>
    </div>,
    document.body,
  );
}
