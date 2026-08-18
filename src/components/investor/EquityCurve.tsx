"use client";

import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_INITIAL_DIMENSION } from "@/components/dashboard/charts/chartTheme";
import { dateShort, fmtNum, fmtSigned } from "@/lib/investors/ui-format";

/**
 * The equity curve: one series, cumulative, with payout markers, an
 * "unsettled" band from the last statement, and (optionally) the area under
 * zero shaded as carried loss. Crosshair tooltip on hover/touch. Charts stay
 * LTR in RTL locales (time flows left→right); the surrounding copy mirrors.
 * `initialDimension` is seeded so a dynamically-loaded chart never measures 0×0.
 */
export interface CurvePoint { d: string; v: number; sub?: string }

export function EquityCurve({ points, color, unsettledFrom, markers = [], zeroBand = false, height = 150, locale, label, currency, signed = false }: {
  points: CurvePoint[]; color: string; unsettledFrom?: string | null; markers?: { d: string; color?: string }[]; zeroBand?: boolean; height?: number; locale: string; label: string; currency: string; signed?: boolean;
}) {
  if (points.length < 2) return <div className="grid h-[120px] place-items-center text-[12px] text-oms-ink-3">—</div>;
  const first = points[0].d, last = points[points.length - 1].d;
  const fmt = (v: number) => (signed ? fmtSigned(v) : fmtNum(v)) + " " + currency;
  const mid = points[Math.floor((points.length - 1) / 2)].d;
  return (
    <div style={{ direction: "ltr" }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height} initialDimension={CHART_INITIAL_DIMENSION}>
        <AreaChart data={points} margin={{ top: 8, right: 6, bottom: 0, left: 6 }}>
          <defs>
            <linearGradient id={`fill-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#EAE7E1" />
          <XAxis dataKey="d" ticks={[first, mid, last]} tickFormatter={(d: string) => dateShort(d, locale)} tick={{ fontSize: 10, fill: "#78726A" }} axisLine={false} tickLine={false} />
          <YAxis hide domain={zeroBand ? ["auto", "auto"] : ["dataMin", "dataMax"]} />
          {unsettledFrom && unsettledFrom >= first && <ReferenceArea x1={unsettledFrom} x2={last} fill="#F4F3EF" fillOpacity={0.9} />}
          {zeroBand && <ReferenceLine y={0} stroke="#DCD8D0" strokeDasharray="2 3" />}
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#fill-${color.replace("#", "")})`} isAnimationActive={false} activeDot={{ r: 4, fill: color, stroke: "#fff", strokeWidth: 2 }} />
          {markers.map((m) => {
            const p = points.find((x) => x.d === m.d);
            return p ? <ReferenceDot key={m.d} x={m.d} y={p.v} r={4.5} fill="#fff" stroke={m.color ?? "#1B1917"} strokeWidth={2} /> : null;
          })}
          <Tooltip cursor={{ stroke: "#78726A", strokeWidth: 1 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as CurvePoint;
            return (
              <div className="rounded-md bg-oms-ink-1 px-2 py-1.5 text-[11.5px] text-white shadow-floating">
                <div className="font-semibold">{dateShort(p.d, locale)}</div>
                <div>{label}: <b>{fmt(p.v)}</b></div>
                {p.sub && <div className="opacity-80">{p.sub}</div>}
              </div>
            );
          }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
