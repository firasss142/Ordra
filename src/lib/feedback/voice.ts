import type { FeedbackCategory, FeedbackMoment, FeedbackSource } from "./taxonomy";
import { prevRange } from "./date-range";
import type { Family } from "./product-family";
import type { FeedbackTopic } from "@/types/feedback";

/** One row of `public.feedback_cube` — live (not discarded) feedback counted per day × facets. */
export interface CubeRow {
  day: string;
  category: FeedbackCategory;
  topic_id: string | null;
  product_id: string | null;
  created_by: string | null;
  source: string;
  n: number;
}

/** The « Saisi par » filter's « livreur Darb »: courier remarks have no author, only a source. */
export const COURIER_AGENT = "darb";

/** How many products a reason names under « Surtout sur ». */
const TOP_PRODUCTS = 3;

/** The order of the page: why they don't buy, what they'd like, what went wrong. */
const ORDER: FeedbackCategory[] = ["objection", "suggestion", "reclamation"];

export interface VoiceInput {
  /** Must cover the previous period too: [prevRange(from, to)[0], to]. */
  cube: CubeRow[];
  topics: FeedbackTopic[];
  from: string;
  to: string;
  /** False when the range starts at the first feedback — there is nothing to compare with. */
  hasPrev: boolean;
  families: Family[];
  familyId: string | null;
  agentId: string | null;
}

export interface VoiceReason {
  topicId: string;
  category: FeedbackCategory;
  count: number;
  prev: number | null;
  response: string | null;
  products: { id: string; label: string; imageUrl: string | null; count: number }[];
}

export interface Voice {
  total: number;
  kpis: { category: FeedbackCategory; count: number; prev: number | null }[];
  /** No reason given, outside complaints: the « à vérifier » pile. */
  toCheck: number;
  /** « Pourquoi ils n'achètent pas » — objection reasons someone gave, most given first. */
  reasons: VoiceReason[];
  /** Objection reasons given in the previous period and not in this one. */
  gone: VoiceReason[];
  /** « Ce qu'ils aimeraient trouver » — the suggestion reasons. */
  wants: VoiceReason[];
  wantsGone: VoiceReason[];
}

const sum = (rows: CubeRow[]) => rows.reduce((s, r) => s + r.n, 0);

/**
 * Every number of « Voix du client » (prototype voix-du-client-et-messages-v2, « Raisons » and
 * the sheet's four minis), from the cube. The product and agent filters narrow everything.
 */
export function computeVoice(input: VoiceInput): Voice {
  const { cube, topics, from, to, hasPrev, families, familyId, agentId } = input;
  const [pFrom, pTo] = prevRange(from, to);

  const familyOf = new Map<string, Family>();
  for (const f of families) for (const id of f.productIds) familyOf.set(id, f);
  const famIds = familyId ? new Set(families.find((f) => f.id === familyId)?.productIds ?? []) : null;
  const keep = (r: CubeRow) =>
    (!famIds || (r.product_id !== null && famIds.has(r.product_id))) &&
    (!agentId || (agentId === COURIER_AGENT ? r.source === "courier" : r.created_by === agentId));

  const cur = cube.filter((r) => r.day >= from && r.day <= to && keep(r));
  const prev = hasPrev ? cube.filter((r) => r.day >= pFrom && r.day <= pTo && keep(r)) : [];

  const kpis = ORDER.map((c) => ({
      category: c,
      count: sum(cur.filter((r) => r.category === c)),
      prev: hasPrev ? sum(prev.filter((r) => r.category === c)) : null,
    }));

  const ranked = (category: FeedbackCategory) => {
    const all = topics
      .filter((t) => t.category === category)
      .map((t) => {
        const mine = cur.filter((r) => r.topic_id === t.id);
        const byFamily = new Map<string, number>();
        for (const r of mine) {
          const f = r.product_id ? familyOf.get(r.product_id) : undefined;
          if (f) byFamily.set(f.id, (byFamily.get(f.id) ?? 0) + r.n);
        }
        const products = [...byFamily.entries()]
          .map(([id, count]) => {
            const f = families.find((x) => x.id === id)!;
            return { id, label: f.label, imageUrl: f.imageUrl, count, i: families.indexOf(f) };
          })
          .sort((a, b) => b.count - a.count || a.i - b.i)
          .slice(0, TOP_PRODUCTS)
          .map(({ i: _i, ...p }) => p);
        return {
          topicId: t.id,
          category,
          count: sum(mine),
          prev: hasPrev ? sum(prev.filter((r) => r.topic_id === t.id)) : null,
          response: t.response ?? null,
          products,
          order: t.sort_order,
        };
      })
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .map(({ order: _o, ...x }) => x);
    return {
      live: all.filter((x) => x.count > 0),
      gone: all.filter((x) => x.count === 0 && (x.prev ?? 0) > 0),
    };
  };

  const obj = ranked("objection");
  const sug = ranked("suggestion");

  return {
    total: sum(cur),
    kpis,
    toCheck: sum(cur.filter((r) => r.topic_id === null && r.category !== "reclamation")),
    reasons: obj.live,
    gone: obj.gone,
    wants: sug.live,
    wantsGone: sug.gone,
  };
}

/** A row the « Ce que disent les clients » quotes are picked from. */
export interface QuoteRow {
  id: string;
  topic_id: string | null;
  created_at: string;
  body: string;
  moment: FeedbackMoment;
  source: FeedbackSource;
  /** The agent who wrote it down; null for the Darb courier. */
  author: string | null;
}

/** The newest `n` rows of each reason. Rows with no reason have no quotes. */
export function pickQuotes(rows: QuoteRow[], n: number): Map<string, QuoteRow[]> {
  const by = new Map<string, QuoteRow[]>();
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const r of sorted) {
    if (!r.topic_id) continue;
    const list = by.get(r.topic_id) ?? [];
    if (list.length < n) list.push(r);
    by.set(r.topic_id, list);
  }
  return by;
}
