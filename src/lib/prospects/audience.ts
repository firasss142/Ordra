/**
 * The campaign audience: what the manager describes in the composer, and how
 * it is stored.
 *
 * One rule governs this file. `prospect_campaigns.filter_json` is read twice —
 * once by the preview that shows a count, once by the RPC that creates the
 * leads. If the two ever read it differently, the manager is shown a number
 * that never happens. So the shape is defined here, once, and both sides go
 * through `toFilterJson` / `fromFilterJson`.
 *
 * The five keys the 2026-06-15 RPC already reads — `order_statuses`,
 * `date_from`, `date_to`, `product_id`, `city` — keep their names and meaning.
 * 1 982 production leads belong to campaigns stored that way, and they must
 * still open in the composer.
 *
 * Design: prototypes/prospects-manager-v1.html (the audience composer).
 */

/** Order outcomes an audience can be drawn from. */
export type OutcomeStatus = "delivered" | "returned" | "rejected";

/** `rejection_reason` in the database — all nine live values. */
export type RejectionReason =
  | "refus_client" | "faux_numero" | "doublon" | "injoignable" | "prix"
  | "non_serieux" | "autre" | "commande_invalide" | "livraison_impossible";

export type Condition =
  /** Which order outcomes the audience is built from. Always present. */
  | { kind: "outcome"; statuses: OutcomeStatus[] }
  /** The window those orders fall in. Always present. */
  | { kind: "period"; mode: "preset" | "custom"; days: number; from: string; to: string }
  /** How long ago the customer last ordered, in days. */
  | { kind: "recency"; from: number; to: number }
  | { kind: "product"; productIds: string[] }
  /** Order value at or above this amount, market currency. */
  | { kind: "basket"; min: number }
  | { kind: "orderCount"; op: "gte" | "eq" | "lte"; n: number }
  | { kind: "city"; cities: string[] }
  /** The customer's return history. */
  | { kind: "returns"; mode: "none" | "any" | "rateAtMost"; rate: number }
  /** Why the order was rejected. Needs a losing outcome to mean anything. */
  | { kind: "reason"; reasons: RejectionReason[] }
  /** Customers whose last order a given agent handled. */
  | { kind: "agent"; agentIds: string[] }
  /** Guard: skip customers who ordered within this many days. */
  | { kind: "notOrderedSince"; days: number }
  /** Guard: skip customers targeted by a campaign within this many days. */
  | { kind: "notInCampaign"; days: number }
  /** Guard: skip customers already closed as "not interested". */
  | { kind: "notLostNotInterested" }
  /** Cap the audience, keeping the most relevant by this sort. */
  | { kind: "limit"; sort: "oldest" | "newest" | "basket"; n: number };

export type ConditionKind = Condition["kind"];

/**
 * The order the composer lists conditions in, and the order `fromFilterJson`
 * rebuilds them in. The two must agree, or a campaign would reopen with its
 * conditions shuffled.
 */
export const CONDITION_KINDS: ConditionKind[] = [
  "outcome", "period", "recency", "product", "orderCount", "basket", "city",
  "returns", "reason", "agent", "notOrderedSince", "notInCampaign",
  "notLostNotInterested", "limit",
];

/**
 * Conditions the composer will not let the manager remove. An audience with no
 * outcome and no window is every customer who ever ordered.
 */
export const FIXED_KINDS: ConditionKind[] = ["outcome", "period"];

/** Which group a condition belongs to in the "add a condition" menu. */
export const CONDITION_GROUP: Record<ConditionKind, "orders" | "customer" | "guard" | "size"> = {
  outcome: "orders", period: "orders", recency: "orders", product: "orders", basket: "orders",
  orderCount: "customer", city: "customer", returns: "customer", reason: "customer", agent: "customer",
  notOrderedSince: "guard", notInCampaign: "guard", notLostNotInterested: "guard",
  limit: "size",
};

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A condition of this kind, with the defaults the composer opens on. */
export function defaultCondition(kind: ConditionKind, now: number = Date.now()): Condition {
  switch (kind) {
    case "outcome": return { kind, statuses: ["delivered"] };
    case "period": return { kind, mode: "preset", days: 90, from: iso(now - 90 * DAY), to: iso(now) };
    case "recency": return { kind, from: 60, to: 120 };
    case "product": return { kind, productIds: [] };
    case "basket": return { kind, min: 200 };
    case "orderCount": return { kind, op: "gte", n: 2 };
    case "city": return { kind, cities: [] };
    case "returns": return { kind, mode: "none", rate: 20 };
    case "reason": return { kind, reasons: ["refus_client", "injoignable"] };
    case "agent": return { kind, agentIds: [] };
    case "notOrderedSince": return { kind, days: 30 };
    case "notInCampaign": return { kind, days: 60 };
    case "notLostNotInterested": return { kind };
    case "limit": return { kind, sort: "oldest", n: 500 };
  }
}

export type TemplateKey = "rebuy" | "winback" | "vip" | "lapsed" | "custom";

/**
 * The starting points. Each is a list of conditions; the dates are filled in
 * from the clock when the template is picked.
 */
export const TEMPLATES: Record<TemplateKey, (now: number) => Condition[]> = {
  /** Bought once, liked it, due to buy again. */
  rebuy: (now) => [
    { kind: "outcome", statuses: ["delivered"] },
    period(180, now),
    { kind: "recency", from: 60, to: 120 },
    { kind: "notOrderedSince", days: 30 },
  ],
  /** The parcel came back. Worth one more call. */
  winback: (now) => [
    { kind: "outcome", statuses: ["returned"] },
    period(90, now),
    { kind: "reason", reasons: ["refus_client", "injoignable", "livraison_impossible"] },
    { kind: "notInCampaign", days: 60 },
  ],
  /** Repeat customers with a real basket. */
  vip: (now) => [
    { kind: "outcome", statuses: ["delivered"] },
    period(365, now),
    { kind: "orderCount", op: "gte", n: 3 },
    { kind: "basket", min: 200 },
    { kind: "notOrderedSince", days: 30 },
  ],
  /** Bought long ago and went quiet. */
  lapsed: (now) => [
    { kind: "outcome", statuses: ["delivered"] },
    period(365, now),
    { kind: "recency", from: 180, to: 365 },
    { kind: "notOrderedSince", days: 30 },
    { kind: "notLostNotInterested" },
  ],
  custom: (now) => [{ kind: "outcome", statuses: ["delivered"] }, period(90, now)],
};

function period(days: number, now: number): Condition {
  return { kind: "period", mode: "preset", days, from: iso(now - days * DAY), to: iso(now) };
}

/** The conditions a template starts from, dated against this clock. */
export function conditionsOf(key: TemplateKey, now: number = Date.now()): Condition[] {
  return TEMPLATES[key](now);
}

/** How many days the period covers. Custom dates win over the preset. */
export function periodDays(c: Extract<Condition, { kind: "period" }>): number {
  if (c.mode !== "custom") return c.days;
  const span = Math.round((Date.parse(c.to) - Date.parse(c.from)) / DAY);
  // Never zero: an inverted or empty range would divide the count by nothing.
  return Number.isFinite(span) ? Math.max(1, span) : c.days;
}

/** The stored shape. The first five keys predate the composer. */
export interface CampaignFilter {
  order_statuses?: OutcomeStatus[];
  date_from?: string;
  date_to?: string;
  /** The old RPC reads one product; the composer may hold several. */
  product_id?: string | null;
  city?: string | null;
  product_ids?: string[];
  cities?: string[];
  recency_days?: { from: number; to: number };
  basket_min?: number;
  order_count?: { op: "gte" | "eq" | "lte"; n: number };
  returns?: { mode: "none" | "any" | "rateAtMost"; rate: number };
  rejection_reasons?: RejectionReason[];
  agent_ids?: string[];
  guards?: {
    not_ordered_days?: number;
    not_in_campaign_days?: number;
    not_lost_not_interested?: boolean;
  };
  limit?: { sort: "oldest" | "newest" | "basket"; n: number };
  /** Whether the period was a preset or hand-picked dates. Display only. */
  period_mode?: "preset" | "custom";
  period_days?: number;
}

export function toFilterJson(conditions: Condition[]): CampaignFilter {
  const json: CampaignFilter = {};
  const guards: NonNullable<CampaignFilter["guards"]> = {};

  for (const c of conditions) {
    switch (c.kind) {
      case "outcome": json.order_statuses = c.statuses; break;
      case "period":
        json.date_from = c.from;
        json.date_to = c.to;
        json.period_mode = c.mode;
        json.period_days = c.days;
        break;
      case "recency": json.recency_days = { from: c.from, to: c.to }; break;
      case "product":
        json.product_ids = c.productIds;
        // The 2026-06-15 RPC reads a single product; keep it in step so a
        // campaign stays meaningful to code that has not been updated.
        json.product_id = c.productIds.length === 1 ? c.productIds[0] : null;
        break;
      case "basket": json.basket_min = c.min; break;
      case "orderCount": json.order_count = { op: c.op, n: c.n }; break;
      case "city":
        json.cities = c.cities;
        json.city = c.cities.length === 1 ? c.cities[0] : null;
        break;
      case "returns": json.returns = { mode: c.mode, rate: c.rate }; break;
      case "reason": json.rejection_reasons = c.reasons; break;
      case "agent": json.agent_ids = c.agentIds; break;
      case "notOrderedSince": guards.not_ordered_days = c.days; break;
      case "notInCampaign": guards.not_in_campaign_days = c.days; break;
      case "notLostNotInterested": guards.not_lost_not_interested = true; break;
      case "limit": json.limit = { sort: c.sort, n: c.n }; break;
    }
  }

  if (Object.keys(guards).length > 0) json.guards = guards;
  return json;
}

/**
 * Read a stored filter back into conditions. Order matters: the composer shows
 * them in this sequence, and a campaign written before the composer existed
 * must open with its five keys intact.
 */
export function fromFilterJson(json: CampaignFilter, now: number = Date.now()): Condition[] {
  const cs: Condition[] = [];

  cs.push({ kind: "outcome", statuses: json.order_statuses ?? ["delivered"] });

  const days = json.period_days ?? 90;
  cs.push({
    kind: "period",
    mode: json.period_mode ?? (json.date_from || json.date_to ? "custom" : "preset"),
    days,
    from: json.date_from ?? iso(now - days * DAY),
    to: json.date_to ?? iso(now),
  });

  if (json.recency_days) cs.push({ kind: "recency", ...json.recency_days });

  // `product_ids` is the composer's; `product_id` is what old rows carry.
  const productIds = json.product_ids ?? (json.product_id ? [json.product_id] : null);
  if (productIds) cs.push({ kind: "product", productIds });

  if (json.order_count) cs.push({ kind: "orderCount", ...json.order_count });
  if (json.basket_min !== undefined) cs.push({ kind: "basket", min: json.basket_min });

  const cities = json.cities ?? (json.city ? [json.city] : null);
  if (cities) cs.push({ kind: "city", cities });

  if (json.returns) cs.push({ kind: "returns", ...json.returns });
  if (json.rejection_reasons) cs.push({ kind: "reason", reasons: json.rejection_reasons });
  if (json.agent_ids) cs.push({ kind: "agent", agentIds: json.agent_ids });

  const g = json.guards;
  if (g?.not_ordered_days !== undefined) cs.push({ kind: "notOrderedSince", days: g.not_ordered_days });
  if (g?.not_in_campaign_days !== undefined) cs.push({ kind: "notInCampaign", days: g.not_in_campaign_days });
  if (g?.not_lost_not_interested) cs.push({ kind: "notLostNotInterested" });

  if (json.limit) cs.push({ kind: "limit", ...json.limit });

  return cs;
}

export interface ConditionError {
  kind: ConditionKind;
  /** Key under `prospects.console.cb.errors` in messages/*.json. */
  code: string;
}

/**
 * What the composer refuses to send. Every rule here exists because the
 * condition would otherwise empty the audience silently, and the manager would
 * have no way to see why.
 */
export function validateConditions(conditions: Condition[]): ConditionError[] {
  const errors: ConditionError[] = [];
  const seen = new Set<ConditionKind>();

  for (const c of conditions) {
    if (seen.has(c.kind)) errors.push({ kind: c.kind, code: "duplicate" });
    seen.add(c.kind);
  }

  const outcome = conditions.find((c) => c.kind === "outcome");
  if (outcome && outcome.kind === "outcome" && outcome.statuses.length === 0) {
    errors.push({ kind: "outcome", code: "empty" });
  }

  const periodC = conditions.find((c) => c.kind === "period");
  const windowDays = periodC?.kind === "period" ? periodDays(periodC) : null;

  for (const c of conditions) {
    switch (c.kind) {
      case "recency":
        if (c.from >= c.to) errors.push({ kind: "recency", code: "inverted" });
        // Asking for a last order older than the window itself returns nobody.
        else if (windowDays !== null && c.to > windowDays) {
          errors.push({ kind: "recency", code: "outsidePeriod" });
        }
        break;
      case "product":
        if (c.productIds.length === 0) errors.push({ kind: "product", code: "empty" });
        break;
      case "city":
        if (c.cities.length === 0) errors.push({ kind: "city", code: "empty" });
        break;
      case "agent":
        if (c.agentIds.length === 0) errors.push({ kind: "agent", code: "empty" });
        break;
      case "reason": {
        if (c.reasons.length === 0) { errors.push({ kind: "reason", code: "empty" }); break; }
        // A delivered order has no rejection reason.
        const losing = outcome?.kind === "outcome"
          && outcome.statuses.some((s) => s === "rejected" || s === "returned");
        if (!losing) errors.push({ kind: "reason", code: "needsLosingOutcome" });
        break;
      }
      case "basket":
        if (c.min <= 0) errors.push({ kind: "basket", code: "positive" });
        break;
      case "orderCount":
        if (c.n <= 0) errors.push({ kind: "orderCount", code: "positive" });
        break;
      case "limit":
        if (c.n <= 0) errors.push({ kind: "limit", code: "positive" });
        break;
      case "notOrderedSince":
      case "notInCampaign":
        if (c.days < 0) errors.push({ kind: c.kind, code: "positive" });
        break;
    }
  }

  return errors;
}

/**
 * The audience a preview returns. `excluded` is the breakdown the composer
 * draws under the count — the guards are the reason a promising template can
 * land on a handful of customers, and hiding that would be a lie.
 */
export interface AudiencePreview {
  /** Customers matching the order conditions, before the guards. */
  matched: number;
  excluded: {
    openLead: number;
    recentlyOrdered: number;
    recentCampaign: number;
    lostNotInterested: number;
  };
  /** matched − excluded, then capped by any limit. */
  net: number;
  sample: { name: string; phone: string; city: string | null; lastOrderDays: number; delivered: number }[];
}

/** Total excluded, for the bar under the counter. */
export function totalExcluded(p: Pick<AudiencePreview, "excluded">): number {
  return Object.values(p.excluded).reduce((s, n) => s + n, 0);
}
