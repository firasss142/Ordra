export interface FunnelLabels {
  leads: string;
  confirmed: string;
  delivered: string;
  toConfirmed: string;
  toDelivered: string;
}

function rate(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
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
  const confirmationRate = rate(confirmed, leads);
  const deliveryRate = rate(delivered, confirmed);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
      <FunnelStage label={labels.leads} value={leads} fill={100} />
      <Connector label={labels.toConfirmed} rate={confirmationRate} />
      <FunnelStage
        label={labels.confirmed}
        value={confirmed}
        fill={leads > 0 ? confirmationRate : 0}
      />
      <Connector label={labels.toDelivered} rate={deliveryRate} />
      <FunnelStage
        label={labels.delivered}
        value={delivered}
        fill={leads > 0 ? rate(delivered, leads) : 0}
      />
    </div>
  );
}

function FunnelStage({
  label,
  value,
  fill,
}: {
  label: string;
  value: number;
  fill: number;
}) {
  const fillWidth = Math.max(20, Math.min(fill, 100));
  return (
    <div className="flex flex-col gap-1 bg-surface-card border border-line-subtle rounded-[8px] px-3 py-2.5 relative overflow-hidden">
      {/* Neutral progress fill — depth of funnel, not a status color */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 start-0 bg-surface-selected opacity-60 pointer-events-none"
        style={{ width: `${fillWidth}%` }}
      />
      <span className="relative text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
        {label}
      </span>
      <span className="relative text-[18px] font-bold text-ink-primary tabular-nums">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function Connector({ label, rate }: { label: string; rate: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1">
      <span className="text-[13px] font-bold text-ink-primary tabular-nums">
        {rate.toFixed(1)}%
      </span>
      <span className="text-[10px] text-ink-secondary uppercase tracking-[0.04em]">
        {label}
      </span>
    </div>
  );
}
