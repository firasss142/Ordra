"use client";

import { useState, useRef, useId, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { Cog } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { SourceLogo } from "@/components/shared/SourceLogo";
import { formatDateTime } from "@/lib/format";
import { statusToneClass } from "@/lib/order-status-tone";
import { eventIconFor } from "@/lib/order-history-event-icon";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import type { OrderHistoryEntry } from "@/app/api/orders/[id]/history/route";

const POPOVER_WIDTH = 320;
const VIEWPORT_GUTTER = 8;
const MIN_SPACE_BELOW = 180;

/**
 * Left-edge accent bar colour, keyed to the same buckets statusToneClass uses.
 * Kept inline so the popover stays self-contained.
 */
function accentBarClass(status: string): string {
  if (status === "delivered") return "bg-status-success";
  if (
    status === "confirmed" ||
    status === "dispatch_scheduled" ||
    status === "uploaded" ||
    status === "scanned" ||
    status === "dispatched" ||
    status === "deposit" ||
    status === "in_transit" ||
    status === "received"
  )
    return "bg-status-action";
  if (
    status === "rejected" ||
    status === "cancelled" ||
    status === "deleted" ||
    status === "returned"
  )
    return "bg-status-critical";
  if (
    status === "pending" ||
    status === "assigned" ||
    status === "attempt_1" ||
    status === "attempt_2" ||
    status === "attempt_3" ||
    status === "callback_scheduled" ||
    status === "unverified" ||
    status === "to_be_returned"
  )
    return "bg-status-warning";
  return "bg-line-strong";
}

export interface StatusHistoryPopoverProps {
  orderId: string;
  /**
   * Storefront platform key (shopify / google_sheets / manual …) — used to
   * render the SourceLogo on the intake card. If omitted, the popover falls
   * back to `data.source_platform` from the endpoint.
   */
  sourcePlatform?: string | null;
  /** The status Badge rendered as the hover trigger. */
  children: React.ReactNode;
}

/**
 * Hover popover anchored on an order's status badge in the orders table.
 *
 * Renders the order's status journey in CHRONOLOGICAL order (oldest first) so
 * the System intake card sits at the top and the timeline reads top-to-bottom
 * as the order's actual lifecycle. The last (newest) card carries the accent
 * bar in its status tone.
 *
 * Intentionally a JOURNEY view — status transitions + assignment events only.
 * Field edits, mapping warnings, escalations, barcode operations,
 * reassignments and dispatch-cancel toggles are still stored in
 * `order_history` and visible in the order detail panel + audit log; they are
 * filtered out on the server (see api/orders/[id]/history/route.ts) to keep
 * the hover read scannable.
 *
 * Hover mechanics (250ms close delay + transparent bridge + portal) are copied
 * from DuplicateOrderBadge so behaviour matches the table's other popovers.
 */
export function StatusHistoryPopover({ orderId, sourcePlatform, children }: StatusHistoryPopoverProps) {
  const t = useTranslations("orders.statusHistory");
  const popoverId = useId();

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

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
      <span
        aria-haspopup="dialog"
        aria-describedby={open ? popoverId : undefined}
        aria-label={t("triggerAria")}
        className="inline-flex"
      >
        {children}
      </span>
      {open && (
        <HistoryPopover
          id={popoverId}
          orderId={orderId}
          sourcePlatform={sourcePlatform ?? null}
          anchorRef={triggerRef}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        />
      )}
    </span>
  );
}

interface HistoryPopoverProps {
  id: string;
  orderId: string;
  sourcePlatform: string | null;
  anchorRef: React.RefObject<HTMLElement | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function HistoryPopover({ id, orderId, sourcePlatform, anchorRef, onMouseEnter, onMouseLeave }: HistoryPopoverProps) {
  const t = useTranslations("orders.statusHistory");
  const tStatuses = useTranslations("orders.statuses");
  const locale = useLocale();
  const isRtl = locale === "ar";

  const { detail, isLoading, error } = useOrderHistory(orderId, true);
  const [coords, setCoords] = useState<{ top: number; left: number; maxHeight: number; openAbove: boolean } | null>(null);

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

  if (typeof document === "undefined" || coords === null) return null;

  const entries = detail?.entries ?? [];
  // Prop wins over the endpoint value so the table caller (OrderRow) can pass
  // the platform it already has without waiting for the SWR fetch to resolve.
  const effectiveSource = sourcePlatform ?? detail?.source_platform ?? null;

  return createPortal(
    <div
      id={id}
      role="dialog"
      aria-labelledby={`${id}-title`}
      dir={isRtl ? "rtl" : undefined}
      lang={isRtl ? "ar" : undefined}
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
      <div className="rounded-2xl border border-line-subtle bg-surface-card shadow-floating text-[13px] text-ink-primary overflow-hidden">
        {/* Header — title + customer name (start) · entry count (end) */}
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <div id={`${id}-title`} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {t("title")}
            </div>
            {detail?.customer_name && (
              <div className="mt-1 text-[15px] font-semibold text-ink-primary truncate">
                {detail.customer_name}
              </div>
            )}
          </div>
          {!isLoading && !error && entries.length > 0 && (
            <span className="shrink-0 rounded-full bg-surface-page px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-ink-secondary">
              {entries.length}
            </span>
          )}
        </div>

        <div className="overflow-y-auto px-3 pb-3 pt-0.5" style={{ maxHeight: coords.maxHeight - 72 }}>
          {isLoading && <div className="px-1 py-1 text-[12px] text-ink-muted">{t("loading")}</div>}
          {!isLoading && error && (
            <div className="px-1 py-1 text-[12px] text-status-critical">{t("error")}</div>
          )}
          {!isLoading && !error && entries.length === 0 && (
            <div className="px-1 py-1 text-[12px] text-ink-muted">{t("empty")}</div>
          )}
          {!isLoading && !error && entries.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {entries.map((entry, i) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  // Entries are chronological (oldest first), so the NEWEST
                  // event is the last one — that's the card we accent.
                  isLatest={i === entries.length - 1}
                  isIntake={entry.from_status === null}
                  sourcePlatform={effectiveSource}
                  locale={locale}
                  statusLabel={tStatuses(entry.to_status as Parameters<typeof tStatuses>[0])}
                  fromStatusLabel={
                    entry.from_status
                      ? tStatuses(entry.from_status as Parameters<typeof tStatuses>[0])
                      : null
                  }
                  systemLabel={t("systemActor")}
                  byLabel={(name) => t("by", { name })}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HistoryRow({
  entry,
  isLatest,
  isIntake,
  sourcePlatform,
  locale,
  statusLabel,
  fromStatusLabel,
  systemLabel,
  byLabel,
}: {
  entry: OrderHistoryEntry;
  isLatest: boolean;
  isIntake: boolean;
  sourcePlatform: string | null;
  locale: string;
  statusLabel: string;
  fromStatusLabel: string | null;
  systemLabel: string;
  byLabel: (name: string) => string;
}) {
  const actorName = entry.actor_name ?? systemLabel;
  const EventIcon = eventIconFor({
    to_status: entry.to_status,
    actor_type: entry.actor_type,
    // The endpoint no longer ships note over the wire, but the icon picker
    // ALSO consults note. We don't have it client-side anymore, so the helper
    // falls back to status / actor_type — exactly what we want here.
    note: null,
  });

  return (
    <li
      className={[
        "relative rounded-xl border border-line-subtle bg-surface-card p-3 transition-shadow hover:shadow-hover-row overflow-hidden",
      ].join(" ")}
    >
      {/* Left accent bar — only on the latest card, tinted to its status tone. */}
      {isLatest && (
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none absolute inset-y-0 w-[3px]",
            accentBarClass(entry.to_status),
          ].join(" ")}
          style={{ insetInlineStart: 0 }}
        />
      )}

      {/* Top row: icon + status pill (start) · timestamp (end) */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          {isIntake && sourcePlatform ? (
            <SourceLogo platform={sourcePlatform} size={14} />
          ) : (
            <span
              aria-hidden="true"
              className={[
                "inline-flex h-5 w-5 items-center justify-center rounded-full",
                statusToneClass(entry.to_status),
              ].join(" ")}
            >
              <EventIcon size={11} strokeWidth={2.25} />
            </span>
          )}
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[12px] font-medium",
              statusToneClass(entry.to_status),
            ].join(" ")}
          >
            {statusLabel}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-ink-muted tabular-nums">
          {formatDateTime(entry.created_at, locale)}
        </span>
      </div>

      {/* Transition: hidden on intake (no from_status). */}
      {fromStatusLabel && (
        <div className="mt-1.5 text-[11px] text-ink-muted">
          {fromStatusLabel} <span aria-hidden="true">→</span> {statusLabel}
        </div>
      )}

      {/* Actor row: avatar + name. System actors get a Cog glyph (no name,
          so Avatar's '?' initials fallback would be meaningless). */}
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-secondary min-w-0">
        {entry.actor_type === "system" ? (
          <span
            aria-label={systemLabel}
            title={systemLabel}
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-selected text-ink-secondary"
          >
            <Cog size={11} strokeWidth={2} aria-hidden="true" />
          </span>
        ) : (
          <Avatar
            user={{ full_name: entry.actor_name, avatar_url: entry.actor_avatar_url }}
            size={18}
          />
        )}
        <span className="truncate">{byLabel(actorName)}</span>
      </div>
    </li>
  );
}
