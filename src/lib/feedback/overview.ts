import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "./taxonomy";
import { prevRange, seriesOf } from "./date-range";
import type { Family } from "./product-family";

/** One row of `public.feedback_cube` — validated, live feedback counted per day × facets. */
export interface CubeRow {
  day: string;
  category: FeedbackCategory;
  topic_id: string | null;
  product_id: string | null;
  created_by: string | null;
  source: string;
  n: number;
}

export interface OverviewInput {
  /** Must cover the previous period too: [prevRange(from, to)[0], to]. */
  cube: CubeRow[];
  from: string;
  to: string;
  /** False when the range starts at the first feedback — there is nothing to compare with. */
  hasPrev: boolean;
  families: Family[];
  /** The market's agents, every one of them — an agent with no entry is the point. */
  agents: { id: string; name: string }[];
  familyId: string | null;
  agentId: string | null;
  category: FeedbackCategory | null;
}

export interface Overview {
  tabs: { all: number; byFamily: { id: string; count: number }[] };
  kpis: { category: FeedbackCategory; count: number; prev: number | null; series: number[] }[];
  /** Validated feedback in the range, under the product and agent filters. */
  total: number;
  mix: { category: FeedbackCategory; count: number }[];
  topics: { category: FeedbackCategory; topicId: string | null; count: number; prev: number | null; share: number }[];
  agents: { id: string; name: string; count: number; byCategory: Record<FeedbackCategory, number> }[];
  agentsTotal: number;
}

const TOP_TOPICS = 6;
const sum = (rows: CubeRow[]) => rows.reduce((s, r) => s + r.n, 0);
const emptyByCategory = (): Record<FeedbackCategory, number> => ({ reclamation: 0, objection: 0, suggestion: 0 });

/**
 * Every number on the manager page, from the cube. Prototype v6 (manager) is the spec:
 *   - the product tabs count the range under the agent filter only;
 *   - the cards, the mix and the topics follow the product and agent filters;
 *   - the topics also follow the category filter, the mix never does;
 *   - the agents box follows the product filter but lists every agent, whatever the agent
 *     filter, and leaves out the courier and anyone who is not an agent.
 */
export function computeOverview(input: OverviewInput): Overview {
  const { cube, from, to, hasPrev, families, agents, familyId, agentId, category } = input;
  const [pFrom, pTo] = prevRange(from, to);

  const famIds = familyId ? new Set(families.find((f) => f.id === familyId)?.productIds ?? []) : null;
  const inProduct = (r: CubeRow) => !famIds || (r.product_id !== null && famIds.has(r.product_id));
  const inAgent = (r: CubeRow) => !agentId || r.created_by === agentId;

  const cur = cube.filter((r) => r.day >= from && r.day <= to);
  const prev = hasPrev ? cube.filter((r) => r.day >= pFrom && r.day <= pTo) : [];

  // ── tabs
  const forTabs = cur.filter(inAgent);
  const byFamily = families
    .map((f, i) => {
      const ids = new Set(f.productIds);
      return { id: f.id, count: sum(forTabs.filter((r) => r.product_id !== null && ids.has(r.product_id))), i };
    })
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .map(({ id, count }) => ({ id, count }));

  // ── cards, mix
  const base = cur.filter((r) => inProduct(r) && inAgent(r));
  const basePrev = prev.filter((r) => inProduct(r) && inAgent(r));
  const kpis = FEEDBACK_CATEGORIES.map((c) => {
    const xs = base.filter((r) => r.category === c);
    return {
      category: c,
      count: sum(xs),
      prev: hasPrev ? sum(basePrev.filter((r) => r.category === c)) : null,
      series: seriesOf(xs.map((r) => ({ day: r.day, n: r.n })), from, to),
    };
  });
  const total = sum(base);
  const mix = kpis.filter((k) => k.count > 0).map((k) => ({ category: k.category, count: k.count }));

  // ── topics
  const forTopics = category ? base.filter((r) => r.category === category) : base;
  const topicTotal = sum(forTopics) || 1;
  const counts = new Map<string, { category: FeedbackCategory; topicId: string | null; count: number }>();
  for (const r of forTopics) {
    const k = `${r.category}|${r.topic_id ?? ""}`;
    const e = counts.get(k);
    if (e) e.count += r.n;
    else counts.set(k, { category: r.category, topicId: r.topic_id, count: r.n });
  }
  const topics = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TOPICS)
    .map((t) => ({
      ...t,
      prev: hasPrev
        ? sum(basePrev.filter((r) => r.category === t.category && r.topic_id === t.topicId))
        : null,
      share: Math.round((t.count * 100) / topicTotal),
    }));

  // ── agents
  const agentIds = new Set(agents.map((a) => a.id));
  const forAgents = cur.filter((r) => inProduct(r) && r.created_by !== null && agentIds.has(r.created_by));
  const agentRows = agents
    .map((a, i) => {
      const byCategory = emptyByCategory();
      for (const r of forAgents) if (r.created_by === a.id) byCategory[r.category] += r.n;
      const count = byCategory.reclamation + byCategory.objection + byCategory.suggestion;
      return { id: a.id, name: a.name, count, byCategory, i };
    })
    .sort((x, y) => y.count - x.count || x.i - y.i)
    .map(({ i: _i, ...rest }) => rest);

  return {
    tabs: { all: sum(forTabs), byFamily },
    kpis,
    total,
    mix,
    topics,
    agents: agentRows,
    agentsTotal: sum(forAgents),
  };
}
