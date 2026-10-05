/**
 * The P&L pipe (prototypes/finances-pnl-v3.html, flowSvg): one band of money.
 * What customers paid enters on the left; each cost leaves it downward as a
 * stream of its own colour; what is left arrives on the right, green.
 *
 * The pipe is always T0 thick — it stands for the 100 dinars paid — so two
 * months compare at a glance. On a loss the costs alone fill the pipe.
 */
import { STREAMS, type Stream } from "./months";

export const PIPE = {
  W: 1120,
  H: 420,
  top: 92,
  T0: 150,
  x0: 40,
  xEnd: 1080,
  xs: [250, 470, 690, 900] as const,
  /** inner radius of a stream's bend */
  Ri: 34,
  /** where the streams stop and their labels start */
  Yb: 318,
};

export interface PipeInput {
  paid: number;
  cogs: number;
  ship: number;
  ads: number;
  pack: number;
  profit: number;
}

export interface PipeStream {
  k: Stream;
  v: number;
  /** thickness */
  t: number;
  x: number;
  /** label centre */
  cx: number;
  /** the stream's band, empty when it carries nothing */
  d: string;
}

export interface PipeGeometry {
  empty: boolean;
  loss: boolean;
  T0: number;
  main: string;
  streams: PipeStream[];
  /** « reste … » inside the pipe, after each of the first three costs */
  rests: { x: number; y: number; v: number; show: boolean }[];
  end: { d: string; h: number; v: number; x: number; y: number; show: boolean };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** the thinnest band a label fits in — below it the figure lives in the header and the tooltip */
const MIN_LABEL_H = { rest: 16, end: 22 };

export function pipeGeometry(m: PipeInput): PipeGeometry {
  const { top, T0, x0, xEnd, xs, Ri, Yb } = PIPE;
  const costs = STREAMS.reduce((a, k) => a + Math.max(0, m[k]), 0);
  const base = Math.max(m.paid, costs);
  const empty = base <= 0;
  const k = empty ? 0 : T0 / base;

  const segs: { x1: number; x2: number; h: number; v: number }[] = [];
  const streams: PipeStream[] = [];
  let h = T0;
  let left = m.paid;
  let prevX = x0;
  STREAMS.forEach((key, i) => {
    const v = m[key];
    const t = Math.max(0, v) * k;
    segs.push({ x1: prevX, x2: xs[i], h, v: left });
    const x = xs[i];
    const yTop = top + h - t;
    const Ro = Ri + t;
    const yBot = yTop + t;
    const d = t > 0.05
      ? `M${x} ${r1(yTop)} A${r1(Ro)} ${r1(Ro)} 0 0 1 ${r1(x + Ro)} ${r1(yTop + Ro)} L${r1(x + Ro)} ${Yb} L${x + Ri} ${Yb} L${x + Ri} ${r1(yBot + Ri)} A${Ri} ${Ri} 0 0 0 ${x} ${r1(yBot)} Z`
      : "";
    streams.push({ k: key, v, t, x, cx: r1(x + Ri + t / 2), d });
    h = Math.max(0, h - t);
    left -= v;
    prevX = xs[i];
  });
  const endH = h < 0.05 ? 0 : h;
  segs.push({ x1: prevX, x2: xEnd, h: endH, v: left });

  // the pipe: top edge flat, bottom edge steps up where each stream leaves
  let main = `M${x0 + 14} ${top} L${xEnd} ${top} L${xEnd} ${r1(top + endH)} `;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    main += `L${s.x2} ${r1(top + s.h)} L${s.x1 + (i ? 0 : 14)} ${r1(top + s.h)} `;
  }
  main += `Q${x0} ${top + T0} ${x0} ${top + T0 - 14} L${x0} ${top + 14} Q${x0} ${top} ${x0 + 14} ${top} Z`;

  const e = segs[segs.length - 1];
  const rad = Math.min(14, endH / 2);
  const endD = endH > 0
    ? `M${e.x1} ${top} L${xEnd - 14} ${top} Q${xEnd} ${top} ${xEnd} ${top + 14} L${xEnd} ${r1(top + endH - rad)} Q${xEnd} ${r1(top + endH)} ${xEnd - 14} ${r1(top + endH)} L${e.x1} ${r1(top + endH)} Z`
    : "";

  return {
    empty,
    loss: m.profit < 0,
    T0,
    main,
    streams,
    rests: segs.slice(1, -1).map((s) => ({ x: (s.x1 + s.x2) / 2, y: r1(top + Math.min(s.h, 60) / 2 + 2), v: s.v, show: s.h >= MIN_LABEL_H.rest })),
    end: { d: endD, h: endH, v: m.profit, x: (e.x1 + xEnd) / 2, y: r1(top + endH / 2), show: endH >= MIN_LABEL_H.end },
  };
}
