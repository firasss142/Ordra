/** Tiny inline SVG line — no axis, no tooltip; the number beside it carries the value. */
export function Sparkline({ values, color, width = 60, height = 22 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const mn = Math.min(...values), mx = Math.max(...values);
  const span = mx - mn || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - mn) / span) * (height - 4)] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ direction: "ltr" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
