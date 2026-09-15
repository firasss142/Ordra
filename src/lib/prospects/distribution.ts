/**
 * Who gets which prospects when a manager empties the pool.
 *
 * This is the console's primary job. Measured in production on 2026-09-15:
 * 1 984 of 1 992 prospects carry no agent, so no queue shows them and nobody
 * calls them. Everything else on the page reports; this acts.
 *
 * Pure on purpose. The pool, the roster and each lead's prior agent arrive as
 * arguments, so the preview the manager confirms and the write that follows
 * run the same function over the same input and cannot disagree.
 *
 * Design: prototypes/prospects-manager-v1.html (the « Répartir » sheet).
 * Rules: plans/suivi-livraison.md decision 33.
 */

/** An agent as the distribution needs to see them. */
export interface DistributionAgent {
  id: string;
  name: string;
  /** Prospects already open in their queue. */
  queue: number;
  /** Calls made today, counted against the daily cap. */
  callsToday: number;
}

/** A prospect in the batch, with the agent who last confirmed that customer. */
export interface DistributionLead {
  id: string;
  /**
   * The agent who last confirmed an order for this phone number, or null when
   * there is none. A prior agent who has since left the roster must be passed
   * as an id that is simply not among the chosen agents — the plan then treats
   * the lead as having no history rather than assigning someone who cannot call.
   */
  lastAgentId: string | null;
}

export type DistributionRule =
  /** Decision 33's default: their own agent where known, round robin otherwise. */
  | "history_then_round_robin"
  /** Equal shares, history ignored. */
  | "round_robin"
  /** The lightest queues receive the most. */
  | "by_queue";

export interface DistributionRow {
  agentId: string;
  name: string;
  /** Leads routed here because this agent already knows the customer. */
  byHistory: number;
  /** Leads routed here to fill the roster evenly. */
  byRoundRobin: number;
  /** byHistory + byRoundRobin. */
  total: number;
  /** The queue this agent will actually face afterwards. */
  queueAfter: number;
}

export interface DistributionPlan {
  /** One row per chosen agent, in the order they were given. */
  rows: DistributionRow[];
  assigned: number;
  /** Prospects the caps could not absorb today. Never silently dropped. */
  left: number;
  /** Which lead goes to which agent, for the write that follows. */
  assignments: { leadId: string; agentId: string }[];
}

export interface DistributionInput {
  leads: DistributionLead[];
  agents: DistributionAgent[];
  rule: DistributionRule;
  /** Calls one agent may be asked to make in a day. */
  cap: number;
}

/**
 * The reference queue length used to weight `by_queue`. An agent at or beyond
 * it is considered full and receives nothing, which is the point of the rule:
 * the manager is trying to relieve them, not bury them.
 */
const QUEUE_CEILING = 40;

/** What this agent can still take today. Never negative. */
function room(a: DistributionAgent, cap: number): number {
  return Math.max(0, cap - a.callsToday);
}

/**
 * Weights for `by_queue`: the emptier the queue, the larger the share. An
 * agent at the ceiling weighs zero and is skipped entirely.
 */
function queueWeight(a: DistributionAgent): number {
  return Math.max(0, QUEUE_CEILING - a.queue);
}

/**
 * Hand out `n` leads across agents that still have room, one at a time, always
 * to whoever has taken the fewest so far. Walking the pool rather than
 * computing shares is what makes a remainder land somewhere instead of being
 * rounded away — 10 leads over 3 agents is 4/3/3, never 3/3/3.
 *
 * `weights` biases the choice for `by_queue`; omitted, every agent is equal.
 */
function spread(
  leadIds: string[],
  agents: DistributionAgent[],
  taken: Map<string, number>,
  cap: number,
  assignments: { leadId: string; agentId: string }[],
  weights?: Map<string, number>,
): string[] {
  const unplaced: string[] = [];

  for (const leadId of leadIds) {
    let best: DistributionAgent | null = null;
    let bestScore = Infinity;

    for (const a of agents) {
      const already = taken.get(a.id) ?? 0;
      if (already >= room(a, cap)) continue;
      const weight = weights?.get(a.id) ?? 1;
      if (weight <= 0) continue;
      // Fewest-taken wins; the weight lets a light queue absorb more before
      // it is considered as loaded as a heavy one.
      const score = already / weight;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }

    if (!best) {
      unplaced.push(leadId);
      continue;
    }
    taken.set(best.id, (taken.get(best.id) ?? 0) + 1);
    assignments.push({ leadId, agentId: best.id });
  }

  return unplaced;
}

/**
 * The plan a manager confirms. Deterministic: same input, same output, so the
 * preview and the write agree.
 */
export function planDistribution(input: DistributionInput): DistributionPlan {
  const { leads, agents, rule, cap } = input;

  const byHistory = new Map<string, number>();
  const byRobin = new Map<string, number>();
  const assignments: { leadId: string; agentId: string }[] = [];

  // Only agents the manager actually chose can receive anything, which is also
  // what makes a departed prior agent fall through to round robin.
  const eligible = new Set(agents.map((a) => a.id));

  let queue = leads.map((l) => l.id);

  if (rule === "history_then_round_robin") {
    const remaining: string[] = [];
    for (const lead of leads) {
      const owner = lead.lastAgentId;
      if (owner === null || !eligible.has(owner)) {
        remaining.push(lead.id);
        continue;
      }
      const agent = agents.find((a) => a.id === owner)!;
      const already = (byHistory.get(owner) ?? 0) + (byRobin.get(owner) ?? 0);
      // Their own customer still counts against their day. Past the cap the
      // lead rejoins the pool rather than overloading the agent.
      if (already >= room(agent, cap)) {
        remaining.push(lead.id);
        continue;
      }
      byHistory.set(owner, (byHistory.get(owner) ?? 0) + 1);
      assignments.push({ leadId: lead.id, agentId: owner });
    }
    queue = remaining;
  }

  // `byHistory` is already spent; `spread` must see the combined total so it
  // does not hand an agent more than their remaining room.
  const taken = new Map<string, number>();
  for (const a of agents) taken.set(a.id, byHistory.get(a.id) ?? 0);
  const before = new Map(taken);

  const weights =
    rule === "by_queue"
      ? new Map(agents.map((a) => [a.id, queueWeight(a)]))
      : undefined;

  const unplaced = spread(queue, agents, taken, cap, assignments, weights);

  for (const a of agents) {
    byRobin.set(a.id, (taken.get(a.id) ?? 0) - (before.get(a.id) ?? 0));
  }

  const rows: DistributionRow[] = agents.map((a) => {
    const h = byHistory.get(a.id) ?? 0;
    const r = byRobin.get(a.id) ?? 0;
    return {
      agentId: a.id,
      name: a.name,
      byHistory: h,
      byRoundRobin: r,
      total: h + r,
      queueAfter: a.queue + h + r,
    };
  });

  return {
    rows,
    assigned: assignments.length,
    left: unplaced.length,
    assignments,
  };
}
