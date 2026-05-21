"use client";

import { useState, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { Layers, AlertTriangle, ExternalLink, Trash2, X } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { canManuallyDeleteOrderStatus } from "@/lib/order-permissions";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

export interface DuplicateOrderBadgeProps {
  count: number;
  siblings: SiblingOrder[];
  hasUploadedSibling: boolean;
  /** The order this dialog is opened from — the server re-verifies siblings against it. */
  anchorOrderId: string;
  /** UX affordance for showing the per-sibling delete button (server is the real gate). */
  canDelete?: boolean;
  /** Called after a successful delete so the parent can revalidate its data. */
  onChange?: () => void;
  locale?: string;
}

/**
 * Marks an order that looks like a DUPLICATE of another (same customer +
 * product + quantity within 24h). The marker is icon-only (Layers) — no text —
 * and CLICK opens a dialog that lists the sibling orders with their statuses and
 * lets a permitted role delete a sibling in place. Distinct from RepeatBuyerBadge
 * (recurrent customer): this uses Layers + warning tone + the data-duplicate marker.
 */
export function DuplicateOrderBadge({
  count,
  siblings,
  hasUploadedSibling,
  anchorOrderId,
  canDelete = false,
  onChange,
}: DuplicateOrderBadgeProps) {
  const t = useTranslations("duplicateOrder");
  const locale = useLocale();
  const dialogId = useId();
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        data-duplicate="true"
        data-has-shipped={hasUploadedSibling ? "true" : undefined}
        aria-haspopup="dialog"
        aria-label={t("trigger.aria", { count })}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
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
        <DuplicateDialog
          id={dialogId}
          siblings={siblings}
          locale={locale}
          anchorOrderId={anchorOrderId}
          canDelete={canDelete}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface DuplicateDialogProps {
  id: string;
  siblings: SiblingOrder[];
  locale: string;
  anchorOrderId: string;
  canDelete: boolean;
  onChange?: () => void;
  onClose: () => void;
}

function DuplicateDialog({
  id,
  siblings,
  locale,
  anchorOrderId,
  canDelete,
  onChange,
  onClose,
}: DuplicateDialogProps) {
  const t = useTranslations("duplicateOrder.dialog");
  const tPop = useTranslations("duplicateOrder.popover");
  const tStatuses = useTranslations("orders.statuses");

  // Local copy so a delete removes the row immediately (optimistic).
  const [rows, setRows] = useState<SiblingOrder[]>(siblings);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      const next = rows.filter((r) => r.id !== s.id);
      setRows(next);
      setBusyId(null);
      onChange?.();
      if (next.length === 0) onClose();
    } catch {
      setError(t("error"));
      setBusyId(null);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(26,26,26,0.5)] p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={[
          "w-[360px] max-w-[90vw] rounded-lg border border-line-subtle bg-surface-card",
          "shadow-[0_8px_24px_rgba(0,0,0,0.10)] text-[13px] text-ink-primary",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-2 border-b border-line-subtle p-3">
          <div>
            <div
              id={`${id}-title`}
              className="flex items-center gap-1.5 font-semibold text-status-warning"
            >
              <AlertTriangle size={14} strokeWidth={2.25} aria-hidden="true" />
              {t("title")}
            </div>
            <div className="mt-0.5 text-[12px] text-ink-muted">{t("subtitle")}</div>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="-m-1 rounded p-1 text-ink-muted hover:bg-status-neutralBg"
          >
            <X size={14} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div className="border-b border-line-subtle bg-status-criticalBg px-3 py-1.5 text-[12px] font-medium text-status-critical">
            {error}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-ink-muted">{t("empty")}</div>
        ) : (
          <ul className="max-h-[280px] space-y-2 overflow-y-auto p-3">
            {rows.map((s) => {
              const href = s.external_id
                ? `/${locale}/orders?q=${encodeURIComponent(s.external_id)}`
                : `/${locale}/orders?q=${encodeURIComponent(s.id)}`;
              const deletable = canDelete && canManuallyDeleteOrderStatus(s.status);
              return (
                <li
                  key={s.id}
                  className="rounded-md border border-line-subtle p-2 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium tabular-nums">
                      {tPop("sibling", { externalId: s.external_id ?? s.id.slice(0, 6) })}
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
                      {s.product_name} · {tPop("qty", { quantity: s.quantity })}
                    </span>
                    <span className="shrink-0">{formatDateTime(s.created_at, locale)}</span>
                  </div>
                  {s.already_shipped && (
                    <div className="inline-flex items-center gap-1 rounded-pill bg-status-criticalBg px-1.5 py-[1px] text-[11px] font-semibold text-status-critical">
                      <AlertTriangle size={10} strokeWidth={2.25} aria-hidden="true" />
                      {tPop("shipped")}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    {s.external_id ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[11px] text-status-action hover:underline"
                      >
                        {tPop("seeOrder")}
                        <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
                      </a>
                    ) : (
                      <span />
                    )}
                    {deletable && (
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
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
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
