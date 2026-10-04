/**
 * Performance › Équipe — facts → the page's view (SERVER side, in the API route).
 * Every block of prototypes/team-performance-v3.html gets its figures here;
 * the browser only chooses what to highlight.
 */
import { agentColorKey } from "@/lib/team/agent-color";
import type { AgentColorKey } from "@/lib/team/room/types";
import { stretchesOf } from "@/lib/team/room/day-view";
import type { OrderFact, TeamPerfFacts } from "./facts";
import { daysOf, type PerfWindow } from "./period";
import {
  addOutcomes,
  defaultDay,
  leaks,
  mapPoint,
  mapTeam,
  outcomesOf,
  productGrid,
  rank,
  segMinutes,
  subOf,
  type AgentFacts,
  type Leak,
  type MapInput,
  type MapPoint,
  type Outcomes,
  type ProductRow,
  type Ranked,
  type Seg,
} from "./model";

export interface AgentInfo {
  id: string;
  name: string;
  color: AgentColorKey;
  avatarUrl: string | null;
}

export interface CardView extends Ranked {
  /** Days she was on shift in the window. */
  days: number;
  /** Her top three leaks, largest first. */
  leaks: Leak[];
}

export interface TeamPerfView {
  window: PerfWindow;
  /** Everyone who did something in either window: ranked first, then by name. */
  agents: AgentInfo[];
  team: Outcomes;
  teamPrev: Outcomes | null;
  ranked: CardView[];
  hors: { id: string; n: number }[];
  map: { points: MapPoint[]; team: ReturnType<typeof mapTeam> };
  products: { cols: string[]; rows: (ProductRow & { name: string; image: string | null })[]; others: [number, number] };
  presence: {
    days: string[];
    /** Agents with at least one day on shift, in the page's order. */
    agents: string[];
    segs: Record<string, Record<string, Seg[]>>;
    totals: Record<string, { min: number; days: number }>;
    defaultDay: string | null;
  };
  reasons: Record<string, { group: string | null; fr: string; ar: string }>;
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function factsOf(orders: readonly OrderFact[]): AgentFacts {
  const sub: Record<string, number> = {};
  let rejTotal = 0, noTry = 0, late = 0;
  for (const o of orders) {
    const s = subOf(o);
    if (s) sub[s] = (sub[s] ?? 0) + 1;
    if (o.st === "rejected") {
      rejTotal += 1;
      if (o.noTry) noTry += 1;
    }
    if (o.late) late += 1;
  }
  return { o: outcomesOf(orders), sub, rejTotal, noTry, late };
}

export function buildView(facts: TeamPerfFacts, window: PerfWindow): TeamPerfView {
  const inCur = (d: string) => d >= window.from && d <= window.to;
  const inPrev = (d: string) => d >= window.pfrom && d <= window.pto;

  const cur = facts.orders.filter((o) => o.cur);
  const prev = facts.orders.filter((o) => !o.cur);
  const curBy = groupBy(cur, (o) => o.a);
  const prevBy = groupBy(prev, (o) => o.a);

  // ── shift segments ──
  const segs: Record<string, Record<string, Seg[]>> = {};
  const prevMin: Record<string, number> = {};
  for (const d of facts.actions) {
    if (inCur(d.day)) (segs[d.a] ??= {})[d.day] = stretchesOf(d.mins);
    else if (inPrev(d.day)) prevMin[d.a] = (prevMin[d.a] ?? 0) + segMinutes(stretchesOf(d.mins));
  }
  const totals: Record<string, { min: number; days: number }> = {};
  for (const [a, byDay] of Object.entries(segs)) {
    const ds = Object.keys(byDay);
    totals[a] = { min: ds.reduce((s, d) => s + segMinutes(byDay[d]), 0), days: ds.length };
  }

  const dec = new Map<string, { up: number; rej: number; pUp: number; pRej: number }>();
  for (const d of facts.decisions) {
    const x = dec.get(d.a) ?? { up: 0, rej: 0, pUp: 0, pRej: 0 };
    if (d.cur) {
      x.up += d.up;
      x.rej += d.rej;
    } else {
      x.pUp += d.up;
      x.pRej += d.rej;
    }
    dec.set(d.a, x);
  }

  // ── who is on the page ──
  const known = new Map(facts.agents.map((a) => [a.id, a]));
  const relevant = facts.agents.filter((a) => curBy.has(a.id) || prevBy.has(a.id) || dec.has(a.id) || segs[a.id] || prevMin[a.id]);

  // ── ranking + leaks ──
  const curOut: Record<string, Outcomes> = {};
  for (const a of relevant) curOut[a.id] = outcomesOf(curBy.get(a.id) ?? []);
  const prevOut: Record<string, Outcomes> = {};
  for (const [a, os] of prevBy) prevOut[a] = outcomesOf(os);
  const { ranked, hors } = rank(curOut, prevOut);
  const af = new Map([...curBy].map(([a, os]) => [a, factsOf(os)]));
  const cards: CardView[] = ranked.map((r) => ({
    ...r,
    days: totals[r.id]?.days ?? 0,
    leaks: leaks(af.get(r.id)!, [...af].filter(([a]) => a !== r.id).map(([, f]) => f)).slice(0, 3),
  }));
  const rankedIds = ranked.map((r) => r.id);
  const byName = [...relevant].sort((x, y) => x.name.localeCompare(y.name));
  const order = [...rankedIds, ...byName.map((a) => a.id).filter((id) => !rankedIds.includes(id))];

  // ── débit × taux ──
  const mapIn: MapInput[] = order
    .filter((id) => (dec.get(id)?.up ?? 0) + (dec.get(id)?.rej ?? 0) > 0 || totals[id])
    .map((id) => {
      const x = dec.get(id) ?? { up: 0, rej: 0, pUp: 0, pRej: 0 };
      return { id, up: x.up, rej: x.rej, min: totals[id]?.min ?? 0, pUp: x.pUp, pRej: x.pRej, pMin: prevMin[id] ?? 0 };
    });

  // ── par produit ──
  const grid = productGrid(cur, rankedIds);
  const pname = new Map(facts.products.map((p) => [p.id, p]));

  const days = daysOf(window.from, window.to);
  const presAgents = order.filter((id) => totals[id]);
  const presSegs: Record<string, Record<string, Seg[]>> = {};
  for (const id of presAgents) presSegs[id] = segs[id];

  return {
    window,
    agents: order.map((id) => {
      const a = known.get(id)!;
      return { id, name: a.name, color: agentColorKey(a.color, id), avatarUrl: a.avatarUrl };
    }),
    team: addOutcomes(Object.values(curOut)),
    teamPrev: prev.length ? outcomesOf(prev) : null,
    ranked: cards,
    hors,
    map: { points: mapIn.map(mapPoint).filter((p): p is MapPoint => p !== null), team: mapTeam(mapIn) },
    products: {
      cols: rankedIds,
      rows: grid.rows.map((r) => ({ ...r, name: pname.get(r.id)?.name ?? "—", image: pname.get(r.id)?.image ?? null })),
      others: grid.others,
    },
    presence: {
      days,
      agents: presAgents,
      segs: presSegs,
      totals,
      defaultDay: presAgents.length ? defaultDay(days, presSegs) : null,
    },
    reasons: Object.fromEntries(facts.reasons.map((r) => [r.key, { group: r.group, fr: r.fr, ar: r.ar }])),
  };
}
