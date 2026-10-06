"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { fmtInt, fmtPct, fmtWeek } from "@/lib/carriers/scorecard/format";
import type { WeekRow } from "@/lib/carriers/scorecard/view-model";
import { useElementWidth } from "./ui";

/**
 * The two charts of the page, plain SVG drawn at the box's real width (as the
 * team pages do: recharts adds ink the design system forbids). Arabic mirrors
 * the x axis and runs the SVG right-to-left, so text anchors stay logical.
 * Transcribed from drawCols / drawLines in prototypes/transporteurs-v2.html.
 */

// The house ink ramp and hairlines (docs/design-system.md §2.3, « Aurore calme »).
const INK_1 = "#101828";
const INK_2 = "#475467";
const INK_3 = "#667085";
const GRID = "rgba(15,23,40,.06)";
const AXIS = "rgba(15,23,40,.16)";
const MUTED = "#98A2B3";

const svgPct = (locale: string, v: number) => (locale === "ar" ? `${Math.round(v)}%` : `${Math.round(v)} %`);

interface TipState { x: number; y: number; content: ReactNode }

function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="tsc-tip pointer-events-none absolute z-20 min-w-[170px] max-w-[280px] px-[12px] py-[10px] text-[12.5px] font-medium text-tr-ink-2"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.content}
    </div>
  );
}

export function TipRow({ swatch, label, value, round = false }: { swatch?: string; label: ReactNode; value: ReactNode; round?: boolean }) {
  return (
    <div className="flex items-center gap-[8px] py-[2px]">
      {swatch ? <i className={`h-[9px] w-[9px] flex-none ${round ? "rounded-full" : "rounded-[3px]"}`} style={{ background: swatch }} /> : null}
      <span>{label}</span>
      <b className="ms-auto ps-[14px] font-[650] tabular-nums text-tr-ink-1">{value}</b>
    </div>
  );
}

function placeTip(e: React.MouseEvent, box: HTMLElement | null, content: ReactNode): TipState | null {
  if (!box) return null;
  const r = box.getBoundingClientRect();
  let x = e.clientX - r.left + 14;
  const y = e.clientY - r.top + 14;
  if (x + 240 > r.width) x = Math.max(0, e.clientX - r.left - 254);
  return { x, y, content };
}

/* ── weekly delivery-rate bars (brief card: 8 weeks · detail: from the first rated week) ── */

export function WeeklyBars({
  rows, color, target, big = false, locale, carrierName,
}: { rows: WeekRow[]; color: string; target: number; big?: boolean; locale: string; carrierName: string }) {
  const t = useTranslations("carrierScorecard");
  const { ref, width } = useElementWidth<HTMLDivElement>(big ? 700 : 480);
  const [tip, setTip] = useState<TipState | null>(null);
  const ar = locale === "ar";

  const W = Math.max(260, width);
  const H = big ? 236 : 88;
  const padT = big ? 24 : 18, padB = big ? 40 : 18, padL = big ? 40 : 2, padR = big ? 92 : 44;
  const ih = H - padT - padB, iw = W - padL - padR, step = iw / Math.max(1, rows.length);
  const bw = Math.min(big ? 36 : 26, step * 0.6);
  const X = (x: number) => (ar ? W - x : x);
  const y = (v: number) => padT + (1 - v / 100) * ih;
  const base = padT + ih;
  const every = big ? (step < 46 ? 2 : 1) : 99;

  const gid = `wb-${useId().replace(/:/g, "")}`;

  const tipFor = (w: WeekRow) => (
    <>
      <div className="mb-[5px] text-[12px] font-bold text-tr-ink-1">{carrierName} · {t("weekOf", { date: fmtWeek(locale, w.week) })}</div>
      <TipRow swatch={color} label={t("wDelivered")} value={w.rate == null ? "—" : fmtPct(locale, w.rate)} />
      <TipRow label={t("wSent")} value={fmtInt(locale, w.sent)} />
      <TipRow label={t("wDelivered")} value={fmtInt(locale, w.delivered)} />
      <TipRow label={t("wFailed")} value={fmtInt(locale, w.failed)} />
      {w.inFlight ? <TipRow label={t("wInFlight")} value={fmtInt(locale, w.inFlight)} /> : null}
      {w.rate == null || w.provisional ? (
        <div className="mt-[5px] border-t border-tr-line-2 pt-[5px] text-[11.5px] text-tr-ink-3">{w.rate == null ? t("wFew") : t("wProv")}</div>
      ) : null}
    </>
  );

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${carrierName} · ${t("weeks8")}`}
        style={{ direction: ar ? "rtl" : "ltr", display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} />
            <stop offset="1" stopColor={color} stopOpacity={0.72} />
          </linearGradient>
        </defs>
        {big
          ? [0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={X(padL)} x2={X(W - padR + 6)} y1={y(v)} y2={y(v)} stroke={v ? GRID : AXIS} />
                {v % 50 === 0 ? <text x={X(padL - 8)} y={y(v) + 4} textAnchor="end" fontSize={11} fill={INK_3}>{svgPct(locale, v)}</text> : null}
              </g>
            ))
          : <line x1={X(padL)} x2={X(W - padR + 4)} y1={base} y2={base} stroke={AXIS} />}
        <line x1={X(padL)} x2={X(W - padR + 4)} y1={y(target)} y2={y(target)} stroke={INK_1} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.75} />
        {rows.map((w, i) => {
          const cx = padL + step * (i + 0.5);
          const x0 = X(cx) - bw / 2;
          const last = i === rows.length - 1;
          let bar: ReactNode;
          if (w.rate == null) {
            bar = <line x1={x0 + 3} x2={x0 + bw - 3} y1={base - 1.5} y2={base - 1.5} stroke={AXIS} strokeWidth={3} strokeLinecap="round" />;
          } else {
            const top = y(w.rate), r = Math.min(4, (base - top) / 2, bw / 2);
            const d = `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z`;
            bar = (
              <>
                {w.provisional
                  ? <path d={d} fill={color} fillOpacity={0.28} stroke={color} strokeWidth={1.3} strokeDasharray="3 2.5" />
                  : <path d={d} fill={`url(#${gid})`} />}
                <text x={X(cx)} y={top - 7} textAnchor="middle" stroke="#fff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
                  fontSize={big ? 11.5 : 10.5} fontWeight={big || last ? 700 : 600} fill={w.provisional ? INK_3 : big || last ? INK_1 : INK_2}>
                  {w.provisional ? "~" : ""}{svgPct(locale, w.rate)}
                </text>
              </>
            );
          }
          return (
            <g key={w.week}>
              {bar}
              {big && i % every === (rows.length - 1) % every ? (
                <>
                  <text x={X(cx)} y={base + 16} textAnchor="middle" fontSize={11} fill={INK_2}>{fmtWeek(locale, w.week)}</text>
                  <text x={X(cx)} y={base + 31} textAnchor="middle" fontSize={10.5} fill={MUTED}>{w.sent ? t("del.colis", { n: fmtInt(locale, w.sent) }) : "—"}</text>
                </>
              ) : null}
              {!big && (i === 0 || last) ? <text x={X(cx)} y={base + 14} textAnchor="middle" fontSize={10.5} fill={INK_3}>{fmtWeek(locale, w.week)}</text> : null}
              <rect x={X(cx) - step / 2} y={0} width={step} height={H} fill="transparent"
                onMouseMove={(e) => setTip(placeTip(e, ref.current, tipFor(w)))} />
            </g>
          );
        })}
        <text x={X(W - padR + 9)} y={y(target) + 4} textAnchor="start" fontSize={11} fontWeight={600} fill={INK_2}>
          {big ? t("targetLabel", { target: svgPct(locale, target) }) : svgPct(locale, target)}
        </text>
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/* ── weekly delivery rate, every carrier on one chart (Comparer) ── */

export interface LineSeries { id: string; name: string; color: string; rows: WeekRow[] }

/** Leading weeks where no carrier has a rate are dropped (at most 7). */
export function trimSeries(series: LineSeries[]): LineSeries[] {
  const n = series[0]?.rows.length ?? 0;
  const firsts = series.map((s) => { const f = s.rows.findIndex((r) => r.rate != null); return f < 0 ? n : f; });
  const drop = Math.min(Math.min(...firsts, n), 7);
  return series.map((s) => ({ ...s, rows: s.rows.slice(drop) }));
}

export function WeeklyLines({ series, target, locale }: { series: LineSeries[]; target: number; locale: string }) {
  const t = useTranslations("carrierScorecard");
  const { ref, width } = useElementWidth<HTMLDivElement>(560);
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const ar = locale === "ar";
  const n = series[0]?.rows.length ?? 0;
  if (n < 2) return <div ref={ref} />;

  const W = Math.max(280, width), H = 250, padT = 14, padB = 30, padL = 40, padR = W < 420 ? 44 : 104;
  const ih = H - padT - padB, iw = W - padL - padR;
  const X = (x: number) => (ar ? W - x : x);
  const xi = (i: number) => padL + (iw * i) / (n - 1);
  const y = (v: number) => padT + (1 - v / 100) * ih;

  const ends = series
    .map((s) => {
      const li = s.rows.map((r) => r.rate != null).lastIndexOf(true);
      return li < 0 ? null : { s, i: li, v: s.rows[li].rate as number, prov: s.rows[li].provisional, yy: y(s.rows[li].rate as number) };
    })
    .filter((e): e is NonNullable<typeof e> => e != null)
    .sort((a, b) => a.yy - b.yy);
  for (let k = 1; k < ends.length; k++) if (ends[k].yy - ends[k - 1].yy < 16) ends[k].yy = ends[k - 1].yy + 16;

  const tipFor = (i: number) => (
    <>
      <div className="mb-[5px] text-[12px] font-bold text-tr-ink-1">{t("weekOf", { date: fmtWeek(locale, series[0].rows[i].week) })}</div>
      {series.map((s, si) => {
        const r = s.rows[i];
        return <TipRow key={s.id} swatch={s.color} round={si === 0} label={s.name}
          value={r.rate == null ? "—" : `${r.provisional ? "~" : ""}${fmtPct(locale, r.rate)}`} />;
      })}
      {series.some((s) => s.rows[i].provisional) ? <div className="mt-[5px] border-t border-tr-line-2 pt-[5px] text-[11.5px] text-tr-ink-3">{t("wProv")}</div> : null}
    </>
  );

  return (
    <div ref={ref} className="relative" onMouseLeave={() => { setTip(null); setHover(null); }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("cmp.weeks")}
        style={{ direction: ar ? "rtl" : "ltr", display: "block", overflow: "visible" }}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={X(padL)} x2={X(W - padR + 4)} y1={y(v)} y2={y(v)} stroke={v ? GRID : AXIS} />
            {v % 50 === 0 ? <text x={X(padL - 8)} y={y(v) + 4} textAnchor="end" fontSize={11} fill={INK_3}>{svgPct(locale, v)}</text> : null}
          </g>
        ))}
        <line x1={X(padL)} x2={X(W - padR + 4)} y1={y(target)} y2={y(target)} stroke={INK_1} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.75} />
        {series[0].rows.map((w, i) => ((n - 1 - i) % 2 === 0
          ? <text key={w.week} x={X(xi(i))} y={H - 8} textAnchor="middle" fontSize={11} fill={INK_3}>{fmtWeek(locale, w.week)}</text>
          : null))}
        {hover != null ? <line x1={X(xi(hover))} x2={X(xi(hover))} y1={padT} y2={padT + ih} stroke={MUTED} strokeWidth={1} opacity={0.7} /> : null}
        {series.map((s, si) => (
          <g key={s.id}>
            {s.rows.map((q, i) => {
              const p = s.rows[i - 1];
              if (!p || p.rate == null || q.rate == null) return null;
              return <line key={`l${i}`} x1={X(xi(i - 1))} y1={y(p.rate)} x2={X(xi(i))} y2={y(q.rate)} stroke={s.color} strokeWidth={2.2}
                strokeDasharray={q.provisional ? "4 3" : undefined} strokeLinecap="round" />;
            })}
            {s.rows.map((r, i) => {
              if (r.rate == null) return null;
              const cx = X(xi(i)), cy = y(r.rate), fill = r.provisional ? "#fff" : s.color;
              return si === 0
                ? <circle key={`m${i}`} cx={cx} cy={cy} r={4.5} fill={fill} stroke={s.color} strokeWidth={2} />
                : <rect key={`m${i}`} x={cx - 4.2} y={cy - 4.2} width={8.4} height={8.4} rx={1.5} fill={fill} stroke={s.color} strokeWidth={2} />;
            })}
          </g>
        ))}
        {padR > 60 ? ends.map((e) => (
          <text key={e.s.id} x={X(xi(e.i) + 10)} y={e.yy + 4} textAnchor="start" stroke="#fff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
            fontSize={11.5} fontWeight={700} fill={INK_1}>
            {e.s.name} {e.prov ? "~" : ""}{svgPct(locale, e.v)}
          </text>
        )) : null}
        {series[0].rows.map((w, i) => (
          <rect key={`h${w.week}`} x={X(xi(i)) - iw / (n - 1) / 2} y={0} width={iw / (n - 1)} height={H} fill="transparent"
            onMouseMove={(e) => { setHover(i); setTip(placeTip(e, ref.current, tipFor(i))); }} />
        ))}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}
