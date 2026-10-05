// Accueil — the bars of orders received. Counts only (no money); pure, tested
// in __tests__/bars.test.ts.

import type { FlowCol } from "./view";

export interface Bar {
  /** First and last day (or hour) the bar covers. */
  from: string;
  to: string;
  n: number;
  /** Not lived yet (an hour still to come today). */
  fut: boolean;
}

export interface Bars {
  bars: Bar[];
  /** Average per bar over the bars already lived. */
  avg: number;
  max: number;
  /** Days folded into weeks. */
  weekly: boolean;
  /** Index of the bar in full colour: the one holding now, else the last lived one. */
  hot: number;
}

/** Beyond this many days, one bar per day becomes slivers: fold into weeks. */
const DAILY_MAX = 45;

export function toBars(cols: readonly FlowCol[]): Bars {
  const weekly = cols.length > DAILY_MAX;
  const size = weekly ? 7 : 1;
  const bars: Bar[] = [];
  let hot = -1;
  for (let i = 0; i < cols.length; i += size) {
    const part = cols.slice(i, i + size);
    const fut = part.every((c) => c.fut);
    bars.push({ from: part[0].k, to: part[part.length - 1].k, n: part.reduce((s, c) => s + c.tot, 0), fut });
    if (part.some((c) => c.now)) hot = bars.length - 1;
  }
  const lived = bars.filter((b) => !b.fut);
  if (hot < 0) hot = lived.length - 1;
  return {
    bars,
    avg: lived.length ? lived.reduce((s, b) => s + b.n, 0) / lived.length : 0,
    max: Math.max(0, ...bars.map((b) => b.n)),
    weekly,
    hot,
  };
}
