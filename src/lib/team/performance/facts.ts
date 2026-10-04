/**
 * Performance › Équipe — the facts `get_team_performance_v2` returns
 * (supabase/migrations/20261005100000_team_performance_v2.sql), normalised.
 * Pure; no React, no Supabase.
 */

/** One order assigned in the window (cur) or the window before. */
export interface OrderFact {
  /** The agent who holds it. */
  a: string;
  cur: boolean;
  st: string;
  /** Reached the carrier at some point (v5's « uploadée »). */
  upl: boolean;
  rsn: string | null;
  sub: string | null;
  /** First line's product. */
  p: string | null;
  /** Rejected without one attempt or callback before; null when not rejected / previous window. */
  noTry: boolean | null;
  /** First call more than 24 h after the assignment; null when never called / previous window. */
  late: boolean | null;
}

export interface DecisionFact {
  a: string;
  cur: boolean;
  up: number;
  rej: number;
}

export interface ActionDay {
  a: string;
  day: string;
  /** Local minutes of the day, sorted. */
  mins: number[];
}

export interface AgentRow {
  id: string;
  name: string;
  color: string | null;
  avatarUrl: string | null;
}

export interface ReasonRow {
  key: string;
  group: string | null;
  fr: string;
  ar: string;
}

export interface TeamPerfFacts {
  agents: AgentRow[];
  orders: OrderFact[];
  decisions: DecisionFact[];
  actions: ActionDay[];
  products: { id: string; name: string; image: string | null }[];
  reasons: ReasonRow[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: any): string | null => (typeof v === "string" && v ? v : null);
const bool = (v: any): boolean | null => (typeof v === "boolean" ? v : null);
const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

export function normalizeFacts(raw: unknown): TeamPerfFacts {
  const r = (raw ?? {}) as Record<string, any>;
  return {
    agents: arr(r.agents)
      .filter((x) => str(x?.id))
      .map((x) => ({ id: x.id, name: str(x.name)?.trim() || "—", color: str(x.color), avatarUrl: str(x.avatar_url) })),
    orders: arr(r.orders)
      .filter((x) => str(x?.a))
      .map((x) => ({
        a: x.a,
        cur: x.cur === true,
        st: str(x.st) ?? "",
        upl: x.upl === true,
        rsn: str(x.rsn),
        sub: str(x.sub),
        p: str(x.p),
        noTry: bool(x.no_try),
        late: bool(x.late),
      })),
    decisions: arr(r.decisions)
      .filter((x) => str(x?.a))
      .map((x) => ({ a: x.a, cur: x.cur === true, up: num(x.up), rej: num(x.rej) })),
    actions: arr(r.actions)
      .filter((x) => str(x?.a) && str(x?.day))
      .map((x) => ({ a: x.a, day: String(x.day).slice(0, 10), mins: arr(x.mins).map(num).sort((p, q) => p - q) })),
    products: arr(r.products)
      .filter((x) => str(x?.id))
      .map((x) => ({ id: x.id, name: str(x.name) ?? "—", image: str(x.image_url) })),
    reasons: arr(r.reasons)
      .filter((x) => str(x?.key))
      .map((x) => ({ key: x.key, group: str(x.group), fr: str(x.fr) ?? x.key, ar: str(x.ar) ?? str(x.fr) ?? x.key })),
  };
}
