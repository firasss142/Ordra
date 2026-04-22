"use client";

interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Optional formatted display (e.g. "42%" or "48 commandes"). */
  display?: string;
}

interface HorizontalBarsProps {
  rows: BarRow[];
  color: string;
  /** When undefined, uses Math.max(...values) or 1. */
  max?: number;
  /** Set true to render tiny dense rows (used in pipeline). */
  compact?: boolean;
}

export function HorizontalBars({ rows, color, max, compact }: HorizontalBarsProps) {
  const effectiveMax = Math.max(max ?? Math.max(...rows.map((r) => r.value), 1), 1);
  const rowHeight = compact ? 28 : 32;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 4 : 6,
        width: "100%",
      }}
    >
      {rows.map((row) => {
        const pct = (row.value / effectiveMax) * 100;
        return (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 60px",
              alignItems: "center",
              gap: 12,
              minHeight: rowHeight,
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: "#1A1A1A",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={row.label}
            >
              {row.label}
            </div>
            <div
              style={{
                background: "#F2F2F2",
                borderRadius: 9999,
                height: compact ? 8 : 10,
                overflow: "hidden",
                width: "100%",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 9999,
                  transition: "width 300ms ease",
                }}
              />
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#1A1A1A",
                fontVariantNumeric: "tabular-nums",
                textAlign: "end",
              }}
            >
              {row.display ?? row.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}
