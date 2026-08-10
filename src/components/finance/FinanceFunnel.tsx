import { ChevronRight } from "lucide-react";

export interface FunnelLabels {
  leads: string;
  confirmed: string;
  delivered: string;
  toConfirmed: string;
  toDelivered: string;
  /**
   * Why a rate is missing, e.g. "cohortes différentes". Optional so the
   * product-rentability page compiles unchanged; it only feeds a `title`
   * tooltip, and its absence degrades to a bare em dash rather than breaking.
   */
  notCohort?: string;
}

/**
 * The smallest denominator a conversion percentage may be quoted from.
 * Mirrors CONFIDENCE_LOW_MIN in lib/dashboard/confidence — below ten, one
 * order swings the rate by more than ten points and the figure is noise.
 */
const MIN_BASE = 10;

/**
 * A rate is publishable only if its base is real and the result is possible.
 *
 * The live Libya market renders leads=1, confirmed=13, delivered=20, and the
 * previous version of this component published that as "1300.0% CONFIRMATION".
 * Over a fixed window the three stages are not one cohort — the orders
 * delivered this month were confirmed last month — so the quotient is not a
 * conversion rate at all. §4.17 G: a headline number and the set it claims to
 * describe must be the same set. When they are not, say nothing.
 */
export function funnelRate(part: number, base: number): number | null {
  if (base < MIN_BASE) return null;
  const r = (part / base) * 100;
  if (!Number.isFinite(r) || r > 100) return null;
  return r;
}

export function FinanceFunnel({
  leads,
  confirmed,
  delivered,
  labels,
}: {
  leads: number;
  confirmed: number;
  delivered: number;
  labels: FunnelLabels;
}) {
  const confirmationRate = funnelRate(confirmed, leads);
  const deliveryRate = funnelRate(delivered, confirmed);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
      <Stage label={labels.leads} value={leads} />
      <Connector label={labels.toConfirmed} rate={confirmationRate} reason={labels.notCohort} />
      <Stage label={labels.confirmed} value={confirmed} />
      <Connector label={labels.toDelivered} rate={deliveryRate} reason={labels.notCohort} />
      <Stage label={labels.delivered} value={delivered} />
    </div>
  );
}

function Stage({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col justify-center gap-1.5 rounded-fin-sm border border-fin-line bg-fin-mint px-4 py-3.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-fin-green-ink">
        {label}
      </span>
      <span className="text-[22px] font-bold leading-none tabular-nums text-fin-navy">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function Connector({
  label,
  rate,
  reason,
}: {
  label: string;
  rate: number | null;
  reason?: string;
}) {
  return (
    <div className="flex items-center justify-center gap-1 px-1">
      <div className="flex flex-col items-center gap-0.5">
        {rate === null ? (
          <span
            data-testid="funnel-rate-suppressed"
            title={reason}
            className="text-[14px] font-semibold leading-none text-fin-ink-3"
          >
            —
          </span>
        ) : (
          <span className="text-[14px] font-bold leading-none tabular-nums text-fin-navy">
            {rate.toFixed(1)}%
          </span>
        )}
        <span className="text-center text-[9.5px] uppercase tracking-[0.04em] text-fin-ink-3">
          {label}
        </span>
      </div>
      <ChevronRight
        aria-hidden
        size={15}
        strokeWidth={2.5}
        className="shrink-0 text-fin-green rtl:rotate-180"
      />
    </div>
  );
}
