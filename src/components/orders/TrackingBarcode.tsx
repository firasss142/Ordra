"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Trash2, Loader2 } from "lucide-react";

interface TrackingBarcodeProps {
  /** Carrier-assigned reference. Component renders nothing if empty. */
  value: string | null | undefined;
  /**
   * Called when the user confirms deleting the barcode. When omitted, the
   * trash button is hidden — read-only contexts (PDFs, list rows) pass
   * nothing here.
   */
  onDelete?: () => Promise<void> | void;
}

export function TrackingBarcode({ value, onDelete }: TrackingBarcodeProps) {
  const t = useTranslations("orders.tracking");
  const svgRef = useRef<SVGSVGElement>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!value || !svgRef.current) return;
    let cancelled = false;
    void import("jsbarcode").then(({ default: JsBarcode }) => {
      if (cancelled || !svgRef.current) return;
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 56,
        width: 1.6,
        background: "#FFFFFF",
        lineColor: "#1A1A1A",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!value) return null;

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — silent
    }
  }

  async function handleConfirmDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="bg-surface-card border-b border-line-subtle px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t("label")}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-secondary hover:text-ink-primary"
              aria-label={t("copy")}
            >
              {copied ? (
                <>
                  <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                  {t("copied")}
                </>
              ) : (
                <>
                  <Copy size={11} strokeWidth={2} aria-hidden="true" />
                  {t("copy")}
                </>
              )}
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="inline-flex items-center justify-center w-6 h-6 rounded-card text-ink-secondary hover:text-status-critical hover:bg-status-criticalBg transition-colors duration-fast"
                aria-label={t("delete")}
                title={t("delete")}
              >
                <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-center bg-white rounded-card py-2 px-3 border border-line-subtle">
          <svg ref={svgRef} aria-label={t("barcodeAlt", { value })} role="img" />
        </div>
        <div
          className="mt-1.5 text-center text-[12px] font-mono tabular-nums text-ink-primary select-all"
          dir="ltr"
        >
          {value}
        </div>
      </div>

      {confirmOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-ink-primary/50"
            onClick={() => !deleting && setConfirmOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-[min(420px,95vw)] bg-surface-card border border-line-subtle rounded-card shadow-floating overflow-hidden"
          >
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-[15px] font-semibold text-ink-primary mb-1">
                {t("deleteConfirmTitle")}
              </h2>
              <p className="text-[13px] text-ink-secondary leading-relaxed">
                {t("deleteConfirmBody")}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 bg-surface-page border-t border-line-subtle">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmOpen(false)}
                className="inline-flex items-center justify-center h-9 px-4 text-[13px] font-medium text-ink-primary border border-line-subtle rounded-card bg-surface-card hover:bg-surface-hover disabled:opacity-50"
              >
                {t("deleteCancel")}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="inline-flex items-center gap-1.5 justify-center h-9 px-4 text-[13px] font-semibold text-white bg-status-critical rounded-card hover:opacity-90 disabled:opacity-50"
              >
                {deleting && (
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                )}
                {t("deleteConfirm")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
