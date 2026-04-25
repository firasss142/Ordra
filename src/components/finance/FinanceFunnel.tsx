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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr auto 1fr",
        alignItems: "center",
        gap: 8,
      }}
    >
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "10px 12px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${fillWidth}%`,
          background: "#F1F8F5",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          position: "relative",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
          position: "relative",
        }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function Connector({ label, rate }: { label: string; rate: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "0 4px",
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {rate.toFixed(1)}%
      </span>
      <span
        style={{
          fontSize: 10,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
    </div>
  );
}
