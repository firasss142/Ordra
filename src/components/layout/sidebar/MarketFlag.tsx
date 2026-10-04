import type { MarketCode, MarketScope } from "@/lib/markets";

/*
 * Drawn flags. The app used regional-indicator emoji, which Windows does not
 * render — a super admin on a PC read « TN » and « LY » in letters. A flag is
 * never the only signal: the market's name always sits beside it.
 */

function star(cx: number, cy: number, outer: number, inner: number, rotation: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = ((rotation + i * 36) * Math.PI) / 180;
    const r = i % 2 ? inner : outer;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

const TN_STAR = star(16.7, 15, 2.9, 1.15, 180);
const LY_STAR = star(18.5, 15, 2.3, 0.92, 180);

function FlagSvg({ code }: { code: MarketCode }) {
  if (code === "tn") {
    return (
      <svg viewBox="0 0 30 30" width="100%" height="100%" focusable="false">
        <rect width="30" height="30" fill="#E70013" />
        <circle cx="15" cy="15" r="7.4" fill="#FFFFFF" />
        <circle cx="14.3" cy="15" r="5.6" fill="#E70013" />
        <circle cx="15.8" cy="15" r="4.6" fill="#FFFFFF" />
        <polygon points={TN_STAR} fill="#E70013" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 30 30" width="100%" height="100%" focusable="false">
      <rect width="30" height="30" fill="#000000" />
      <rect width="30" height="7.5" fill="#E70013" />
      <rect y="22.5" width="30" height="7.5" fill="#239E46" />
      <circle cx="13.6" cy="15" r="4.6" fill="#FFFFFF" />
      <circle cx="14.9" cy="15" r="3.8" fill="#000000" />
      <polygon points={LY_STAR} fill="#FFFFFF" />
    </svg>
  );
}

export function MarketFlag({ scope, size, radius = 5 }: { scope: MarketScope; size: number; radius?: number }) {
  const style = { width: size, height: size, borderRadius: radius };
  if (scope === "all") {
    return (
      <span className="sb-flag sb-flag-all" style={style} aria-hidden="true">
        <span>
          <FlagSvg code="tn" />
        </span>
        <span>
          <FlagSvg code="ly" />
        </span>
      </span>
    );
  }
  return (
    <span className="sb-flag" style={style} aria-hidden="true">
      <FlagSvg code={scope} />
    </span>
  );
}
