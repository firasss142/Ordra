"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { X, CheckCircle2, AlertCircle, MinusCircle, Copy } from "lucide-react";
import { useCarriers } from "@/hooks/useCarriers";

type SkipReason =
  | "order_not_found"
  | "wrong_status"
  | "wrong_market"
  | "no_destination"
  | "no_state"
  | "no_service"
  | "missing_address"
  | "unknown_carrier";

interface DryRunResp {
  dry_run: true;
  eligible: string[];
  skipped: { order_id: string; reason: SkipReason }[];
}
interface ExecResp {
  dry_run: false;
  succeeded: { order_id: string; tracking_number: string | null }[];
  failed: { order_id: string; error: string; errorCode?: string }[];
  skipped: { order_id: string; reason: SkipReason }[];
  needs_confirmation: { order_id: string; duplicate_external_id: string | null }[];
}

interface BulkUploadPanelProps {
  selectedIds: string[];
  /** The market whose carriers are offered. null = super_admin "all markets". */
  marketId: string | null;
  onClose: () => void;
  /** Called after a run completes and the user closes — clears + revalidates. */
  onDone: () => void;
}

function groupByReason(skipped: { reason: SkipReason }[]): Array<[SkipReason, number]> {
  const m = new Map<SkipReason, number>();
  for (const s of skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
  return Array.from(m.entries());
}

/**
 * Bulk upload selected orders to one carrier/account. Three stages:
 *  pick (choose carrier) → preview (server dry-run: ready vs skipped) →
 *  results (per-order succeeded / failed / skipped / duplicate buckets).
 * The server preflight is authoritative; this panel only sends ids + carrier id.
 */
export function BulkUploadPanel({
  selectedIds,
  marketId,
  onClose,
  onDone,
}: BulkUploadPanelProps) {
  const t = useTranslations("orders.bulkUpload");
  const { carriers } = useCarriers(marketId);
  const panelRef = useRef<HTMLDivElement>(null);

  const [stage, setStage] = useState<"pick" | "preview" | "results">("pick");
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DryRunResp | null>(null);
  const [results, setResults] = useState<ExecResp | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pickCarrier(id: string) {
    setCarrierId(id);
    setStage("preview");
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/orders/bulk-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: selectedIds, carrier_id: id, dry_run: true }),
      });
      if (!res.ok) {
        setError(t("networkError"));
        return;
      }
      setPreview((await res.json()) as DryRunResp);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function execute(ids: string[], confirmDuplicates: boolean) {
    if (!carrierId) return;
    setStage("results");
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/orders/bulk-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_ids: ids,
          carrier_id: carrierId,
          confirm_duplicates: confirmDuplicates,
        }),
      });
      if (!res.ok) {
        setError(t("networkError"));
        return;
      }
      setResults((await res.json()) as ExecResp);
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  const eligibleCount = preview?.eligible.length ?? 0;

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
          className="flex max-h-[90dvh] w-[520px] max-w-[92vw] flex-col rounded-card bg-surface-card shadow-floating"
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

            {/* ── PICK ───────────────────────────────────────────── */}
            {stage === "pick" && (
              <div className="flex flex-col gap-2">
                <div className="text-[13px] font-medium text-ink-secondary">
                  {t("pickCarrierLabel")}
                </div>
                {marketId === null ? (
                  <div className="rounded-card border border-line-subtle bg-surface-page px-3 py-3 text-[13px] text-ink-secondary">
                    {t("selectMarketFirst")}
                  </div>
                ) : carriers.length === 0 ? (
                  <div className="rounded-card border border-line-subtle bg-surface-page px-3 py-3 text-[13px] text-ink-secondary">
                    {t("noCarriers")}
                  </div>
                ) : (
                  carriers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCarrier(c.id)}
                      className="flex h-10 w-full items-center justify-between rounded-card border border-line-subtle px-3 text-[13px] text-ink-primary transition-colors duration-fast hover:bg-surface-hover"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-[11px] uppercase tracking-wide text-ink-secondary">
                        {c.code}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* ── PREVIEW ────────────────────────────────────────── */}
            {stage === "preview" && (
              <div className="flex flex-col gap-3">
                {loading ? (
                  <div className="text-[13px] text-ink-secondary">{t("loadingPreview")}</div>
                ) : preview ? (
                  <>
                    <div className="flex items-center gap-2 text-[13px] font-medium text-status-success">
                      <CheckCircle2 size={15} aria-hidden="true" />
                      {t("readyCount", { count: eligibleCount })}
                    </div>
                    {preview.skipped.length > 0 && (
                      <div className="rounded-card border border-line-subtle bg-surface-page p-3">
                        <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink-secondary">
                          <MinusCircle size={15} aria-hidden="true" />
                          {t("skippedCount", { count: preview.skipped.length })}
                        </div>
                        <ul className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                          {groupByReason(preview.skipped).map(([reason, count]) => (
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

            {/* ── RESULTS ────────────────────────────────────────── */}
            {stage === "results" && (
              <div className="flex flex-col gap-3">
                {loading ? (
                  <div className="text-[13px] text-ink-secondary">{t("uploading")}</div>
                ) : results ? (
                  <>
                    {results.succeeded.length > 0 && (
                      <div className="rounded-card border border-status-success/30 bg-status-successBg p-3">
                        <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-status-success">
                          <CheckCircle2 size={15} aria-hidden="true" />
                          {t("succeededCount", { count: results.succeeded.length })}
                        </div>
                        <ul className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                          {results.succeeded.map((s) => (
                            <li key={s.order_id}>
                              {t("trackingLabel", { tracking: s.tracking_number ?? "—" })}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {results.needs_confirmation.length > 0 && (
                      <div className="rounded-card border border-status-warning/30 bg-status-warningBg p-3">
                        <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-status-warning">
                          <Copy size={15} aria-hidden="true" />
                          {t("needsConfirmationCount", {
                            count: results.needs_confirmation.length,
                          })}
                        </div>
                        <ul className="mb-2 flex flex-col gap-1 text-[12px] text-ink-secondary">
                          {results.needs_confirmation.map((n) => (
                            <li key={n.order_id}>
                              {t("duplicateOf", { externalId: n.duplicate_external_id ?? "—" })}
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() =>
                            execute(
                              results.needs_confirmation.map((n) => n.order_id),
                              true,
                            )
                          }
                          className="inline-flex h-8 items-center rounded-card bg-status-warning px-3 text-[12px] font-medium text-white"
                        >
                          {t("uploadAnyway")}
                        </button>
                      </div>
                    )}

                    {results.failed.length > 0 && (
                      <div className="rounded-card border border-status-critical/30 bg-status-criticalBg p-3">
                        <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-status-critical">
                          <AlertCircle size={15} aria-hidden="true" />
                          {t("failedCount", { count: results.failed.length })}
                        </div>
                        <ul className="mb-2 flex flex-col gap-1 text-[12px] text-ink-secondary">
                          {results.failed.map((f) => (
                            <li key={f.order_id} className="truncate">
                              {f.error}
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => execute(results.failed.map((f) => f.order_id), false)}
                          className="inline-flex h-8 items-center rounded-card border border-line-subtle bg-surface-card px-3 text-[12px] font-medium text-ink-primary hover:bg-surface-hover"
                        >
                          {t("retryFailed")}
                        </button>
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

          {/* Footer actions */}
          <div className="flex shrink-0 justify-end gap-2 border-t border-line-subtle bg-surface-page px-5 py-3">
            {stage === "preview" && (
              <>
                <button
                  type="button"
                  onClick={() => setStage("pick")}
                  disabled={loading}
                  className="inline-flex h-9 items-center rounded-card border border-line-subtle bg-surface-card px-4 text-[13px] font-medium text-ink-primary hover:bg-surface-hover disabled:opacity-50"
                >
                  {t("back")}
                </button>
                <button
                  type="button"
                  onClick={() => execute(selectedIds, false)}
                  disabled={loading || eligibleCount === 0}
                  className="inline-flex h-9 items-center rounded-card bg-ink-primary px-4 text-[13px] font-medium text-white hover:bg-ink-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t("uploadButton", { count: eligibleCount })}
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
