"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { Check } from "lucide-react";
import { useCarrierRates } from "@/hooks/useCarrierRates";
import { useCarrierPerformance } from "@/hooks/useCarrierPerformance";
import { compareCarriers } from "@/lib/carriers/carrier-comparison";
import { pickInitialCarrier } from "@/lib/carriers/initial-carrier-selection";
import { CarrierComparisonCard } from "./CarrierComparisonCard";

interface ScheduleDispatchModalProps {
  orderId: string;
  marketId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface CarrierOption {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalTimeString(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function defaultScheduledAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

/**
 * Schedule a future dispatch from the order detail panel (not the post-call
 * flow — see PostCallActionSheet's own schedule_after_confirm step for that).
 * Always auto-dispatches: there is no "schedule but don't send" mode here, so
 * the auto-dispatch card is a standing confirmation, not an opt-in toggle —
 * matching the "Planifier la livraison" mockup exactly (no checkbox, just
 * the green card + carrier list + timeline preview).
 *
 * The carrier list uses the same "meilleur choix" comparison (cost + 30d
 * delivery rate + median transit) as PostCallActionSheet's picker, via the
 * shared CarrierComparisonCard — one ranking, one look, wherever an agent or
 * manager picks a carrier for this order.
 */
export function ScheduleDispatchModal({
  orderId,
  marketId,
  onClose,
  onSuccess,
}: ScheduleDispatchModalProps) {
  const t = useTranslations("orders.scheduleDispatch");
  const panelRef = useRef<HTMLDivElement>(null);

  const [scheduledAt, setScheduledAt] = useState<Date>(() => defaultScheduledAt());
  const [dateVal, setDateVal] = useState(toLocalDateString(scheduledAt));
  const [timeVal, setTimeVal] = useState(toLocalTimeString(scheduledAt));
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  useEffect(() => {
    if (dateVal && timeVal) {
      const combined = new Date(`${dateVal}T${timeVal}:00`);
      if (!isNaN(combined.getTime())) setScheduledAt(combined);
    }
  }, [dateVal, timeVal]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const { data: carriersData } = useSWR<{ data: CarrierOption[] }>(
    marketId ? `/api/carriers?market_id=${marketId}&is_active=true` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const carriers = (carriersData?.data ?? []).filter((c) => c.is_active);

  const { ratesByCarrierId } = useCarrierRates(orderId, true);
  const { performanceByCarrierId } = useCarrierPerformance(marketId, true);

  const comparison = compareCarriers(
    carriers.map((c) => ({
      carrierId: c.id,
      cost: ratesByCarrierId[c.id]?.quotedFee ?? null,
      deliveryRate: performanceByCarrierId[c.id]?.deliveryRate30d ?? null,
      transitHours: performanceByCarrierId[c.id]?.medianTransitHours ?? null,
    })),
  );
  const comparisonByCarrierId: Record<string, (typeof comparison.rows)[number]> = {};
  for (const row of comparison.rows) comparisonByCarrierId[row.carrierId] = row;

  // Pre-select "meilleur choix", same rule PostCallActionSheet uses — the
  // agent's own pick always wins once made.
  useEffect(() => {
    const next = pickInitialCarrier({
      carriers,
      coverageOf: () => "covered",
      recommendedCarrierId: comparison.bestChoiceCarrierId,
      currentSelection: carrierId,
    });
    if (next !== null && next !== carrierId) setCarrierId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriers, carrierId, comparison.bestChoiceCarrierId]);

  const isFuture = scheduledAt.getTime() > Date.now();
  const canSubmit = isFuture && !loading && carrierId !== null;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/schedule-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_at: scheduledAt.toISOString(),
          auto_dispatch: true,
          carrier_id: carrierId,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? t("networkError"));
        return;
      }
      onSuccess();
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

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
          className="flex max-h-[85vh] w-[480px] max-w-[90vw] flex-col overflow-y-auto rounded-card bg-surface-card shadow-floating"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-line-subtle px-5 py-4">
            <span className="text-[16px] font-semibold text-ink-primary">{t("title")}</span>
            <button
              type="button"
              onClick={onClose}
              className="text-[14px] text-ink-secondary transition-colors duration-fast hover:text-ink-primary"
            >
              {t("cancel")}
            </button>
          </div>

          <div className="p-5">
            {error && (
              <div
                role="alert"
                className="mb-3 rounded-md border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
              >
                {error}
              </div>
            )}

            <p className="mb-3 text-[13px] text-ink-secondary">{t("hint")}</p>

            <div className="mb-4 flex gap-2">
              <div className="flex-1">
                <div className="mb-1 text-[12px] font-medium text-ink-secondary">
                  {t("dateLabel")}
                </div>
                <input
                  type="date"
                  aria-label={t("dateLabel")}
                  min={today}
                  value={dateVal}
                  onChange={(e) => setDateVal(e.target.value)}
                  className="w-full rounded-md border border-line-strong bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
                />
              </div>
              <div className="flex-1">
                <div className="mb-1 text-[12px] font-medium text-ink-secondary">
                  {t("timeLabel")}
                </div>
                <input
                  type="time"
                  aria-label={t("timeLabel")}
                  value={timeVal}
                  onChange={(e) => setTimeVal(e.target.value)}
                  className="w-full rounded-md border border-line-strong bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
                />
              </div>
            </div>

            {!isFuture && (
              <p className="mb-3 text-[12px] text-status-critical">{t("mustBeFuture")}</p>
            )}

            {/* Always auto-dispatches — a standing confirmation, not a toggle:
                this modal has no "schedule but don't send" mode. */}
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-dispatch-ok-edge bg-dispatch-ok-tint p-3">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-dispatch-ok text-white">
                <Check size={11} strokeWidth={3} aria-hidden="true" />
              </span>
              <div>
                <div className="text-[13px] font-medium text-dispatch-ok-ink">
                  {t("autoDispatchLabel")}
                </div>
                <div className="mt-0.5 text-[12px] leading-4 text-dispatch-ok-ink/80">
                  {t("autoDispatchHint")}
                </div>
              </div>
            </div>

            <div className="mb-2 text-[12px] font-medium text-ink-secondary">
              {t("pickCarrier")}
            </div>
            {!carriersData ? (
              <div className="py-2 text-[13px] text-ink-secondary">…</div>
            ) : carriers.length === 0 ? (
              <div className="mb-3 rounded-md border border-status-warning/30 bg-status-warningBg px-3 py-2 text-[13px] text-status-warning">
                {t("noActiveCarrier")}
              </div>
            ) : (
              <div role="radiogroup" aria-label={t("pickCarrier")} className="mb-4 flex flex-col gap-2">
                {carriers.map((c) => {
                  const row = comparisonByCarrierId[c.id];
                  return (
                    <CarrierComparisonCard
                      key={c.id}
                      name={c.name}
                      code={c.code}
                      selected={carrierId === c.id}
                      blocked={false}
                      isBestChoice={row?.isBestChoice ?? false}
                      cost={row?.cost ?? null}
                      deliveryRate={row?.deliveryRate ?? null}
                      transitHours={row?.transitHours ?? null}
                      marketId={marketId}
                      onSelect={() => setCarrierId(c.id)}
                    />
                  );
                })}
              </div>
            )}

            {/* Timeline preview: "maintenant" → the scheduled date/time. */}
            <div className="mb-4 rounded-xl bg-surface-sunken p-3">
              <p className="mb-2 text-[12px] leading-5 text-ink-secondary">
                {t("schedulePreviewLabel", { date: `${dateVal} ${timeVal}` })}
              </p>
              <div className="relative h-1 rounded-pill bg-line-strong">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 start-0 h-1 w-full rounded-pill bg-dispatch-ok/30"
                />
                <span
                  aria-hidden="true"
                  className="absolute start-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-ink-muted"
                />
                <span
                  aria-hidden="true"
                  className="absolute end-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-dispatch-ok"
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-ink-secondary">
                <span>{t("scheduleNow")}</span>
                <span className="font-medium text-dispatch-ok-ink">
                  {dateVal} · {timeVal}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="inline-flex w-full items-center justify-center rounded-xl bg-dispatch-ok px-4 py-2.5 text-[14px] font-semibold text-white transition-colors duration-fast hover:bg-dispatch-ok-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t("saving") : t("submit")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
