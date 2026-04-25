import Link from "next/link";

export type KpiTone = "neutral" | "success" | "warning" | "critical";

export interface KpiTile {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  onClick?: () => void;
  tone?: KpiTone;
}

interface Props {
  tiles: KpiTile[];
}

const TONE_TEXT: Record<KpiTone, string> = {
  neutral: "text-ink-primary",
  success: "text-status-success",
  warning: "text-status-warning",
  critical: "text-status-critical",
};

function tileBody(tile: KpiTile) {
  const valueColor = TONE_TEXT[tile.tone ?? "neutral"];
  return (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
        {tile.label}
      </span>
      <span className={`text-[22px] font-bold tabular-nums ${valueColor}`}>
        {tile.value}
      </span>
      {tile.hint ? (
        <span className="text-[12px] text-ink-secondary">{tile.hint}</span>
      ) : null}
    </>
  );
}

const TILE_BASE =
  "flex flex-col gap-1 flex-1 min-h-[64px] bg-surface-card border border-line-subtle rounded-card px-4 py-3 text-start";
const TILE_INTERACTIVE =
  "hover:shadow-hover-row transition-shadow duration-fast cursor-pointer";

export function WarehouseKpiStrip({ tiles }: Props) {
  return (
    <div className="flex gap-3 flex-wrap">
      {tiles.map((tile) => {
        if (tile.href) {
          return (
            <Link
              key={tile.label}
              href={tile.href}
              className={`no-underline ${TILE_BASE} ${TILE_INTERACTIVE}`}
              data-tile
            >
              {tileBody(tile)}
            </Link>
          );
        }
        if (tile.onClick) {
          return (
            <button
              key={tile.label}
              type="button"
              onClick={tile.onClick}
              className={`${TILE_BASE} ${TILE_INTERACTIVE}`}
              data-tile
            >
              {tileBody(tile)}
            </button>
          );
        }
        return (
          <div key={tile.label} className={TILE_BASE} data-tile>
            {tileBody(tile)}
          </div>
        );
      })}
    </div>
  );
}
