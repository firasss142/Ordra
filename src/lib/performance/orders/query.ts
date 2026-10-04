// The page's state in its URL, so a link opens the same view
// (?period=30d|90d|m:2026-09|custom&from=&to= &p=<id>.<size>~<size>,<id> &ag=<id>,<id>
//  &cmp=p:<products>|a:<agents>|d:<from>|<to> &boutique=<storefront id>). Shared by the page and the API.

import { isDay, isPeriodKey, type PeriodKey } from "./period";
import type { ProductSel } from "./facts";

export type Cmp =
  | null
  | { kind: "p"; sel: ProductSel }
  | { kind: "a"; ag: string[] }
  | { kind: "d"; from: string; to: string };

export interface PerfState {
  period: PeriodKey;
  from: string | null;
  to: string | null;
  sel: ProductSel;
  ag: string[];
  cmp: Cmp;
  /** One store only — the card clicked on Accueil (?boutique=). */
  store: string | null;
}

export const EMPTY_STATE: PerfState = { period: "30d", from: null, to: null, sel: {}, ag: [], cmp: null, store: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decSel(raw: string | null): ProductSel {
  const out: ProductSel = {};
  for (const tok of (raw ?? "").split(",")) {
    const [id, sizes] = tok.split(".");
    if (!UUID.test(id ?? "")) continue;
    const vs = sizes ? sizes.split("~").filter((v) => UUID.test(v)) : [];
    out[id] = vs.length ? vs : null;
  }
  return out;
}

function encSel(sel: ProductSel): string {
  return Object.entries(sel)
    .map(([id, v]) => (v && v.length ? `${id}.${v.join("~")}` : id))
    .join(",");
}

function decAg(raw: string | null): string[] {
  return [...new Set((raw ?? "").split(",").filter((x) => UUID.test(x)))];
}

export function parseState(q: URLSearchParams): PerfState {
  const per = q.get("period");
  let period: PeriodKey = isPeriodKey(per) ? per : "30d";
  let from: string | null = null;
  let to: string | null = null;
  if (period === "custom") {
    const f = q.get("from");
    const t = q.get("to");
    if (isDay(f) && isDay(t) && f <= t) {
      from = f;
      to = t;
    } else period = "30d";
  }
  const c = q.get("cmp") ?? "";
  let cmp: Cmp = null;
  if (c.startsWith("p:") || c === "p") cmp = { kind: "p", sel: decSel(c.slice(2)) };
  else if (c.startsWith("a:") || c === "a") cmp = { kind: "a", ag: decAg(c.slice(2)) };
  else if (c.startsWith("d:")) {
    const [f, t] = c.slice(2).split("|");
    if (isDay(f) && isDay(t) && f <= t) cmp = { kind: "d", from: f, to: t };
  }
  const b = q.get("boutique");
  return { period, from, to, sel: decSel(q.get("p")), ag: decAg(q.get("ag")), cmp, store: b && UUID.test(b) ? b : null };
}

export function stateToParams(s: PerfState): URLSearchParams {
  const q = new URLSearchParams();
  if (s.period !== "30d") q.set("period", s.period);
  if (s.period === "custom" && s.from && s.to) {
    q.set("from", s.from);
    q.set("to", s.to);
  }
  if (Object.keys(s.sel).length) q.set("p", encSel(s.sel));
  if (s.ag.length) q.set("ag", s.ag.join(","));
  if (s.cmp?.kind === "p") q.set("cmp", `p:${encSel(s.cmp.sel)}`);
  if (s.cmp?.kind === "a") q.set("cmp", `a:${s.cmp.ag.join(",")}`);
  if (s.cmp?.kind === "d") q.set("cmp", `d:${s.cmp.from}|${s.cmp.to}`);
  if (s.store) q.set("boutique", s.store);
  return q;
}
