"use client";

import { useState, useRef, useId, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { Layers, AlertTriangle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/format";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

export interface DuplicateOrderBadgeProps {
  count: number;
  siblings: SiblingOrder[];
  hasUploadedSibling: boolean;
  locale?: string;
}

/**
 * Warns that an order looks like a DUPLICATE of another order (same customer +
 * product + quantity within 24h). Deliberately distinct from RepeatBuyerBadge
 * (which uses Star/AlertTriangle + action/critical tones) so agents never
 * confuse "same order placed twice" with "recurrent customer": this badge uses
 * the Layers icon + warning (amber) tone and a data-duplicate marker.
 */
export function DuplicateOrderBadge({
  count,
  siblings,
  hasUploadedSibling,
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
    closeTimer.current = setTimeout(() => setOpen(false), 120);
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
        tone="warning"
        data-duplicate="true"
        data-has-shipped={hasUploadedSibling ? "true" : undefined}
        aria-describedby={open ? popoverId : undefined}
        tabIndex={0}
        className={[
          "cursor-default select-none",
          // Sharper outline when a sibling is already shipped — the case that
          // can cause a real double-upload to the carrier.
          hasUploadedSibling ? "ring-1 ring-status-critical/40" : "",
        ].join(" ")}
      >
        <Layers size={11} strokeWidth={2.25} aria-hidden="true" />
        {t("badge.label", { count })}
      </Badge>
      {open && (
        <PopoverPanel
          id={popoverId}
          anchorRef={triggerRef}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          siblings={siblings}
          locale={locale}
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
  siblings: SiblingOrder[];
  locale: string;
}

const POPOVER_WIDTH = 320;
const VIEWPORT_GUTTER = 8;

function PopoverPanel({
  id,
  anchorRef,
  onMouseEnter,
  onMouseLeave,
  siblings,
  locale,
}: PopoverPanelProps) {
  const t = useTranslations("duplicateOrder.popover");
  const tStatuses = useTranslations("orders.statuses");
  const isRtl = locale === "ar";

  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function reposition() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
      let left = isRtl ? rect.right - width : rect.left;
      left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(left, window.innerWidth - width - VIEWPORT_GUTTER),
      );
      setCoords({ top: rect.bottom + 4, left });
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

  return createPortal(
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
      className={[
        "z-[1000]",
        "rounded-lg border border-line-subtle bg-surface-card",
        "shadow-[0_8px_24px_rgba(0,0,0,0.10)] p-3",
        "text-[13px] text-ink-primary",
      ].join(" ")}
    >
      <div className="mb-1 flex items-start gap-1.5 font-semibold text-status-warning">
        <AlertTriangle size={13} strokeWidth={2.25} aria-hidden="true" className="mt-px shrink-0" />
        <span>{t("headline")}</span>
      </div>
      <div className="mb-2 text-[12px] text-ink-muted">{t("subheadline")}</div>

      <ul className="space-y-1.5 border-t border-line-subtle pt-2">
        {siblings.map((s) => {
          const href = s.external_id
            ? `/${locale}/orders?q=${encodeURIComponent(s.external_id)}`
            : `/${locale}/orders?q=${encodeURIComponent(s.id)}`;
          return (
            <li key={s.id} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate font-medium tabular-nums">
                  {t("sibling", { externalId: s.external_id ?? s.id.slice(0, 6) })}
                </span>
                <span className="shrink-0 text-ink-muted">
                  {formatDateTime(s.created_at, locale)}
                </span>
                <span
                  className={[
                    "shrink-0 rounded-pill px-1.5 py-[1px] text-[11px] font-medium",
                    statusToneClass(s.status),
                  ].join(" ")}
                >
                  {tStatuses(s.status as Parameters<typeof tStatuses>[0])}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
                <span className="truncate">
                  {s.product_name} · {t("qty", { quantity: s.quantity })}
                </span>
                {s.external_id && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex shrink-0 items-center gap-1 text-status-action hover:underline"
                  >
                    {t("seeOrder")}
                    <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
                  </a>
                )}
              </div>
              {s.already_shipped && (
                <div className="inline-flex items-center gap-1 rounded-pill bg-status-criticalBg px-1.5 py-[1px] text-[11px] font-semibold text-status-critical">
                  <AlertTriangle size={10} strokeWidth={2.25} aria-hidden="true" />
                  {t("shipped")}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  );
}

function statusToneClass(status: string): string {
  if (status === "delivered") return "bg-status-successBg text-status-success";
  if (
    status === "uploaded" ||
    status === "scanned" ||
    status === "dispatched" ||
    status === "deposit" ||
    status === "in_transit"
  ) {
    return "bg-[#EAF2FB] text-status-action";
  }
  return "bg-status-neutralBg text-ink-secondary";
}
