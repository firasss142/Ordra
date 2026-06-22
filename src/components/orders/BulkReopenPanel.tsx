"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { X, CheckCircle2, AlertCircle, MinusCircle, AlertTriangle } from "lucide-react";

type SkipReason = "order_not_found" | "wrong_market" | "not_uploaded" | "carrier_not_found";

interface ReopenResp {
  succeeded: { order_id: string; void_outcome: "carrier_voided" | "local_only" }[];
  failed: { order_id: string; error: string }[];
  skipped: { order_id: string; reason: SkipReason }[];
  /** Orders NOT reopened because the carrier cancellation couldn't be confirmed. */
  void_failed?: { order_id: string; reason: string }[];
}

interface BulkReopenPanelProps {
  selectedIds: string[];
  /** How many of the selected orders are uploaded (server re-validates). */
  eligibleCount: number;
  onClose: () => void;
  onDone: () => void;
}

function groupByReason(skipped: { reason: SkipReason }[]): Array<[SkipReason, number]> {
  const m = new Map<SkipReason, number>();
  for (const s of skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
  return Array.from(m.entries());
}

/**
 * Bulk reopen of UPLOADED orders. Confirm (warns the carrier shipments will be
 * cancelled) → results (voided / local-only / failed / skipped). "Reopen" here
 * means the carrier-delete flow: void the shipment and revert uploaded →
 * confirmed. Eligibility is previewed client-side from the selection; the server
 * is authoritative and reports anything that wasn't actually uploadable.
 */
export function BulkReopenPanel({
  selectedIds,
  eligibleCount,
  onClose,
  onDone,
}: BulkReopenPanelProps) {
  const t = useTranslations("orders.bulkReopen");
  const panelRef = useRef<HTMLDivElement>(null);

  const [stage, setStage] = useState<"confirm" | "results">("confirm");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ReopenResp | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const skippedPreview = Math.max(0, selectedIds.length - eligibleCount);

  async function run(ids: string[] = selectedIds, confirmManualCancel = false) {
    setStage("results");
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/orders/bulk-reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_ids: ids,
          confirm_manual_cancel: confirmManualCancel,
        }),
      });
      if (!res.ok) {
        setError(t("networkError"));
        return;
      }
      setResults((await res.json()) as ReopenResp);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  const voided = results?.succeeded.filter((s) => s.void_outcome === "carrier_voided").length ?? 0;
  const localOnly = results?.succeeded.filter((s) => s.void_outcome === "local_only").length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-primary/50"
      onClick={onClose}
    >
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          fallbackFocus: () => panelRef.current ?? document.body,
        }}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[90dvh] w-[480px] max-w-[92vw] flex-col rounded-card bg-surface-card shadow-floating"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-line-subtle px-5 py-4">
            <div className="text-[16px] font-semibold text-ink-primary">{t("title")}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("cancel")}
              className="rounded p-1 text-ink-secondary hover:bg-surface-hover"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {error && (
              <div
                role="alert"
                className="mb-3 rounded border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
              >
                {error}
              </div>
            )}

            {/* ── CONFIRM ────────────────────────────────────────── */}
            {stage === "confirm" && (
              <div className="flex flex-col gap-3">
                {eligibleCount === 0 ? (
                  <div className="rounded-card border border-line-subtle bg-surface-page px-3 py-3 text-[13px] text-ink-secondary">
                    {t("nothingEligible")}
                  </div>
                ) : (
                  <>
                    <div className="text-[14px] font-medium text-ink-primary">
                      {t("eligibleCount", { count: eligibleCount })}
                    </div>
                    {skippedPreview > 0 && (
                      <div className="text-[13px] text-ink-secondary">
                        {t("skippedCount", { count: skippedPreview })}
                      </div>
                    )}
                    <div className="flex items-start gap-2 rounded-card border border-status-warning/30 bg-status-warningBg px-3 py-2 text-[13px] text-status-warning">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{t("warn")}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── RESULTS ────────────────────────────────────────── */}
            {stage === "results" && (
              <div className="flex flex-col gap-3">
                {loading ? (
                  <div className="text-[13px] text-ink-secondary">{t("reopening")}</div>
                ) : results ? (
                  <>
                    {voided > 0 && (
                      <div className="flex items-center gap-2 rounded-card border border-status-success/30 bg-status-successBg px-3 py-2 text-[13px] font-medium text-status-success">
                        <CheckCircle2 size={15} aria-hidden="true" />
                        {t("voidedCount", { count: voided })}
                      </div>
                    )}
                    {localOnly > 0 && (
                      <div className="flex items-start gap-2 rounded-card border border-status-warning/30 bg-status-warningBg px-3 py-2 text-[13px] text-status-warning">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{t("localOnlyCount", { count: localOnly })}</span>
                      </div>
                    )}
                    {(results.void_failed?.length ?? 0) > 0 && (
                      <div className="rounded-card border border-status-warning/30 bg-status-warningBg p-3">
                        <div className="mb-2 flex items-start gap-2 text-[13px] font-medium text-status-warning">
                          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                          <span>{t("voidFailedCount", { count: results.void_failed!.length })}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            run(results.void_failed!.map((v) => v.order_id), true)
                          }
                          className="inline-flex h-8 items-center rounded-card bg-status-warning px-3 text-[12px] font-medium text-white"
                        >
                          {t("reopenAnyway")}
                        </button>
                      </div>
                    )}
                    {results.failed.length > 0 && (
                      <div className="rounded-card border border-status-critical/30 bg-status-criticalBg p-3">
                        <div className="flex items-center gap-2 text-[13px] font-medium text-status-critical">
                          <AlertCircle size={15} aria-hidden="true" />
                          {t("failedCount", { count: results.failed.length })}
                        </div>
                      </div>
                    )}
                    {results.skipped.length > 0 && (
                      <div className="rounded-card border border-line-subtle bg-surface-page p-3">
                        <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink-secondary">
                          <MinusCircle size={15} aria-hidden="true" />
                          {t("skippedResultsCount", { count: results.skipped.length })}
                        </div>
                        <ul className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                          {groupByReason(results.skipped).map(([reason, count]) => (
                            <li key={reason} className="flex justify-between gap-3">
                              <span>{t(`reason_${reason}`)}</span>
                              <span className="tabular-nums">{count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-line-subtle bg-surface-page px-5 py-3">
            {stage === "confirm" && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 items-center rounded-card border border-line-subtle bg-surface-card px-4 text-[13px] font-medium text-ink-primary hover:bg-surface-hover"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => run()}
                  disabled={eligibleCount === 0}
                  className="inline-flex h-9 items-center rounded-card bg-status-critical px-4 text-[13px] font-medium text-white hover:bg-[#B82408] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t("reopenButton", { count: eligibleCount })}
                </button>
              </>
            )}
            {stage === "results" && !loading && (
              <button
                type="button"
                onClick={() => {
                  onDone();
                  onClose();
                }}
                className="inline-flex h-9 items-center rounded-card bg-ink-primary px-4 text-[13px] font-medium text-white hover:bg-ink-primary/90"
              >
                {t("done")}
              </button>
            )}
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
