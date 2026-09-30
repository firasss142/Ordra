/**
 * The manager console's arithmetic: campaign funnels, trends and agent load.
 * Pure, so the numbers on screen can be argued with in a test rather than in
 * production. Mirrors managerBody() in prototypes/prospects-v3.html.
 *
 * Labels live in messages/*.json under `prospects.console`; this file only
 * produces figures.
 */
import type { CampaignFilter } from "./audience";

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
  /** How the campaign contacts people: call, wa, or wa_call. */
  channel?: "call" | "wa" | "wa_call";
  /** Of its audience, how many still have no agent. */
  pool?: number;
  /** Business-number campaigns only (wa_sender = api). */
  whatsapp?: CampaignWhatsApp;
}

export interface CampaignWhatsApp {
  launch_status: "draft" | "pending_template" | "ready" | "launched" | "rejected";
  language: "ar" | "fr" | null;
  template_status: string | null;
  template_name: string | null;
  template_rejected_reason: string | null;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
  /** Of `skipped`, the rows Meta refused under its per-user marketing cap (131049). */
  skipped_marketing_cap?: number;
  /** When launch_status last moved (submitted, approved, rejected, launched). 20260925170000. */
  status_at?: string | null;
  launched_at?: string | null;
  /** Pacing: messages per hour for the whole campaign, and the « 10-20 » send window. */
  rate?: number | null;
  window?: string | null;
  follow_up_hours?: number | null;
  /** The body as the manager wrote it ({nom} {produit}…), for « Modifier et resoumettre ». */
  message?: string | null;
  image_url?: string | null;
  /** The stored audience (filter_json), so the sheet can reopen on it. */
  filter?: CampaignFilter | null;
}

export interface AgentLoad {
  id: string;
  name: string;
  open_leads: number;
  /** Hot prospects sitting in this agent's queue right now. */
  hot_waiting: number;
  calls_today: number;
  converted_today: number;
  /** Callbacks whose time has passed. */
  late_callbacks?: number;
  /** Of today's calls, how many reached someone. */
  reached_today?: number;
  /** Minutes since this agent last moved anything. null = never. */
  last_touch_minutes?: number | null;
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

  /** Prospects nobody owns. The figure the page opens on. */
  pool: number;
  /** How many campaigns that unowned stock came from. */
  pool_campaigns: number;
  /** How long the oldest of them has waited, in days. */
  pool_oldest_days: number | null;
  /** Owned or not, never rung. */
  never_called: number;
  total: number;
  late_callbacks: number;
  lost_30d: number;
  calls_today: number;
  reached_today: number;
  /** Whose queue the oldest hot prospect is sitting in. */
  oldest_hot_agent: string | null;
}

/** Where the stock stops. Each stage counts who reached it, not who stayed. */
export interface Funnel {
  created: number;
  pool: number;
  assigned: number;
  called: number;
  reached: number;
  conv: number;
  deliv: number;
}

/** Lost prospects by reason — the `lead_lost_reason` enum, sparsely filled. */
export type LossByReason = Record<string, number>;

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

/**
 * How often the console re-reads itself. A business-number template waiting
 * for Meta is the one thing on this page that changes on someone else's
 * clock; while one is pending the page looks every 30 s, so an approval or a
 * refusal (written by the webhook) is seen — and announced — within the
 * minute. Otherwise the usual 5 minutes.
 */
export function consoleRefreshInterval(data: { campaigns?: CampaignResult[] } | undefined): number {
  return data?.campaigns?.some((c) => c.whatsapp?.launch_status === "pending_template") ? 30_000 : 300_000;
}
