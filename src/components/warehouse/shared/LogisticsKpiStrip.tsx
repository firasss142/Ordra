import Link from "next/link";

export interface KpiTileDef {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "neutral" | "success" | "warning" | "critical";
}

const TONE_COLOR: Record<NonNullable<KpiTileDef["tone"]>, string> = {
  neutral: "var(--wh-ink-1)",
  success: "var(--wh-ok)",
  warning: "var(--wh-warn)",
  critical: "var(--wh-bad)",
};

function KpiTile({ tile }: { tile: KpiTileDef }) {
  const valueColor = tile.tone ? TONE_COLOR[tile.tone] : "var(--wh-ink-1)";

  const inner = (
    <div
      data-tile
      style={{
        backgroundColor: "var(--wh-surface)",
        border: "1px solid var(--wh-border)",
        borderRadius: 8,
        padding: "14px 16px",
        minHeight: 64,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flex: 1,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--wh-ink-2)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {tile.label}
      </span>
      <span
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {tile.value}
      </span>
      {tile.hint ? (
        <span style={{ fontSize: 12, color: "var(--wh-ink-2)" }}>{tile.hint}</span>
      ) : null}
    </div>
  );

  if (tile.href) {
    return (
      <Link
        href={tile.href}
        style={{ flex: 1, textDecoration: "none", display: "flex" }}
      >
        {inner}
      </Link>
    );
  }

  return inner;
}

interface Props {
  tiles: KpiTileDef[];
}

export function LogisticsKpiStrip({ tiles }: Props) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        marginBlockEnd: 16,
      }}
    >
      {tiles.map((tile) => (
        <KpiTile key={tile.label} tile={tile} />
      ))}
    </div>
  );
}
