export function MarginBar({
  marginPct,
  width = 64,
}: {
  marginPct: number | null;
  width?: number;
}) {
  if (marginPct == null) {
    return (
      <span style={{ fontSize: 12, color: "#6D7175", fontVariantNumeric: "tabular-nums" }}>
        —
      </span>
    );
  }

  const isNegative = marginPct < 0;
  const fillPct = Math.min(Math.abs(marginPct), 100);
  const fillColor = isNegative ? "#D72C0D" : "#008060";
  const label = `${marginPct.toFixed(1)}%`;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          position: "relative",
          width,
          height: 6,
          backgroundColor: "#F1F2F4",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          data-testid="margin-bar-fill"
          style={{
            width: `${fillPct}%`,
            height: "100%",
            backgroundColor: fillColor,
            transition: "width 200ms ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: isNegative ? "#D72C0D" : "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
          minWidth: 48,
          textAlign: "end",
        }}
      >
        {label}
      </span>
    </div>
  );
}
