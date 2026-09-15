/**
 * The manager console's arithmetic: campaign funnels, trends and agent load.
 * Pure, so the numbers on screen can be argued with in a test rather than in
 * production. Mirrors managerBody() in prototypes/prospects-v3.html.
 *
 * Labels live in messages/*.json under `prospects.console`; this file only
 * produces figures.
 */

export interface CampaignResult {
  id: string;
  name: string;
  offer: string | null;
  /** Leads the campaign put in front of agents. */
  audience: number;
  /** Of those, how many an agent has actually worked. */
  called: number;
  converted: number;
  /** Delivered revenue, market currency. Only delivered counts as earned. */
  revenue: number;
  created_at: string;
}

export interface AgentLoad {
  id: string;
  name: string;
  open_leads: number;
  /** Hot prospects sitting in this agent's queue right now. */
  hot_waiting: number;
  calls_today: number;
  converted_today: number;
}

export interface AgentLoadRanked extends AgentLoad {
  /** Conversions per call today, as a percentage; null when nobody was called. */
  rate: number | null;
}

export interface ConsoleMetrics {
  new_7d: number;
  new_prev_7d: number;
  hot_waiting: number;
  /** Minutes the oldest unanswered hot prospect has been waiting. */
  oldest_hot_minutes: number | null;
  /** Median minutes from lead creation to first contact. */
  median_first_contact_minutes: number | null;
  median_first_contact_prev: number | null;
  converted_30d: number;
  delivered_30d: number;
  delivered_revenue_30d: number;
}

export interface FunnelWidths {
  uncalled: number;
  called: number;
  converted: number;
}

/**
 * Three segments across one bar: never called, called but not converted, and
 * converted. They always sum to 100 so the bar has no gap, and never go
 * negative — production has campaigns whose `called` exceeds the audience the
 * query returns today, because leads were reassigned out of the campaign.
 */
export function funnelWidths(c: Pick<CampaignResult, "audience" | "called" | "converted">): FunnelWidths {
  if (c.audience <= 0) return { uncalled: 0, called: 0, converted: 0 };

  const converted = Math.min(c.converted, c.audience);
  const called = Math.min(Math.max(c.called, converted), c.audience);
  const pct = (n: number) => (n / c.audience) * 100;

  return {
    uncalled: pct(c.audience - called),
    called: pct(called - converted),
    converted: pct(converted),
  };
}

/**
 * Of the people an agent actually reached, how many bought. Deliberately not
 * measured against the whole audience: an untouched campaign list says
 * something about distribution, not about the agents working it.
 */
export function conversionRate(c: Pick<CampaignResult, "called" | "converted">): number | null {
  if (c.called <= 0) return null;
  return Math.round((c.converted / c.called) * 100);
}

export interface Trend {
  pct: number;
  direction: "up" | "down" | "flat";
}

/** The change against the previous period; null when there is nothing to compare to. */
export function trend(current: number, previous: number): Trend | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

/**
 * The roster, worst-served first, because the manager's question is "who needs
 * help now". Hot prospects waiting outrank a merely long queue: a hot one goes
 * cold in an hour, a backlog does not.
 */
export function agentLoad(agents: AgentLoad[]): AgentLoadRanked[] {
  return agents
    .map((a) => ({
      ...a,
      rate: a.calls_today > 0 ? Math.round((a.converted_today / a.calls_today) * 100) : null,
    }))
    .sort((a, b) => b.hot_waiting - a.hot_waiting || b.open_leads - a.open_leads);
}
