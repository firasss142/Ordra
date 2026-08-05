"use client";

import { useTranslations } from "next-intl";
import { Activity } from "lucide-react";
import type { ProductSignals, SignalTone } from "@/lib/products/signals";

export interface ProductSheetSignalsProps {
  signals: ProductSignals | null;
}

const FIGURE_TONE: Record<SignalTone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  critical: "text-status-critical",
};

/**
 * Outcome rates for this product, computed from orders — nothing here is
 * authored, so it cannot go stale. Colour sits on the figure, never on a
 * container (§4.16): a rate is a status.
 *
 * Renders nothing when every signal was suppressed for a small sample. A
 * confident-looking "100%" off three orders would cost more trust than the
 * missing number.
 */
export function ProductSheetSignals({ signals }: ProductSheetSignalsProps) {
  const t = useTranslations("productSheet");
  const tReason = useTranslations("orders.rejectionReasons");

  if (!signals?.hasAny) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Activity size={12} strokeWidth={2} aria-hidden="true" className="text-ink-muted" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          {t("signals")}
        </span>
        {signals.totalOutcomes > 0 && (
          <span className="ms-auto text-[11px] text-ink-muted tabular-nums">
            {t("signalSample", { count: signals.totalOutcomes })}
          </span>
        )}
      </div>

      <div className="flex items-start gap-6">
        {signals.confirmation && (
          <Figure
            label={t("signalConfirmation")}
            percent={signals.confirmation.percent}
            tone={signals.confirmation.tone}
          />
        )}
        {signals.returns && (
          <Figure
            label={t("signalReturns")}
            percent={signals.returns.percent}
            tone={signals.returns.tone}
          />
        )}
      </div>

      {signals.topRejectionReason && (
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-ink-muted">{t("signalTopRejection")}</span>
          <span className="inline-flex items-center rounded-pill bg-surface-selected px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
            {tReason(signals.topRejectionReason)}
          </span>
        </div>
      )}
    </section>
  );
}

function Figure({
  label,
  percent,
  tone,
}: {
  label: string;
  percent: number;
  tone: SignalTone;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-[18px] font-bold tabular-nums leading-none ${FIGURE_TONE[tone]}`}>
        {percent}
        <span className="text-[12px] font-semibold">%</span>
      </span>
      <span className="text-[11px] text-ink-secondary">{label}</span>
    </div>
  );
}
