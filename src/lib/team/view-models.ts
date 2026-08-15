/**
 * View models — the bridge between the RPC payloads (lib/team/types) and the
 * two pages. Pure functions; every rule that decides what a manager sees
 * (ranking, streaks, masking, coaching) is applied here, once, and tested.
 */
import {
  DEFAULT_GOAL_TARGETS,
  MIN_TREATED_FOR_RATE,
  computeGoalStreak,
  evaluateDailyGoals,
  rankAgents,
  rateOf,
  suggestCoachingTarget,
  confirmationsPerHour,
  type DailyGoalsResult,
  type GoalTargets,
  type CoachingSuggestion,
} from "./goals";
import type {
  LiveAgent,
  PerfAgent,
  PerfDaily,
  PerfProduct,
  TeamLive,
  TeamPerformance,
} from "./types";

// ---------- shared helpers ----------

export function localDaysBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromISO}T00:00:00Z`);
  const end = new Date(`${toISO}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function targetsFor(defaults: { daily_treated: number; min_rate: number; conf_per_hour?: number }, over: PerfAgent["targets"] | LiveAgent["targets"]): GoalTargets {
  return {
    dailyTreated: over.daily_treated ?? defaults.daily_treated ?? DEFAULT_GOAL_TARGETS.dailyTreated,
    minRate: over.min_rate ?? defaults.min_rate ?? DEFAULT_GOAL_TARGETS.minRate,
    confPerHour: over.conf_per_hour ?? defaults.conf_per_hour ?? DEFAULT_GOAL_TARGETS.confPerHour,
  };
}

// ---------- performance ----------

export interface ProductSpread {
  min: { agentId: string; name: string; rate: number; treated: number; confirmed: number };
  max: { agentId: string; name: string; rate: number; treated: number; confirmed: number };
  spread: number;
}

/** Best and worst agent on one product, among those with ≥ 10 treated. */
export function productSpread(
  agents: PerfProduct["agents"],
  names: Record<string, string>,
): ProductSpread | null {
  const q = agents
    .filter((a) => a.treated >= MIN_TREATED_FOR_RATE)
    .map((a) => ({ agentId: a.agent_id, name: names[a.agent_id] ?? "?", rate: rateOf(a.confirmed, a.treated) ?? 0, treated: a.treated, confirmed: a.confirmed }))
    .sort((a, b) => a.rate - b.rate);
  if (q.length < 2) return null;
  const min = q[0];
  const max = q[q.length - 1];
  return { min, max, spread: Math.round((max.rate - min.rate) * 10) / 10 };
}

export interface PerfAgentView {
  agent: PerfAgent;
  targets: GoalTargets;
  /** null when under MIN_TREATED_FOR_RATE */
  rate: number | null;
  /** treated per active hour, null when no activity */
  throughput: number | null;
  confPerHour: number | null;
  streak: { current: number; best: number };
  coaching: CoachingSuggestion | null;
  /** one entry per period day, zero-filled */
  heat: PerfDaily[];
  topMotif: { reason: string; n: number; total: number } | null;
}

export interface PerformanceView {
  days: string[];
  team: {
    treated: number;
    confirmed: number;
    rate: number | null;
    activeMinutes: number;
    medianThroughput: number | null;
    goal: { value: number; target: number; pct: number };
    agentsActive: number;
    agentsTotal: number;
    confPerHourTarget: number;
  };
  byId: Record<string, PerfAgentView>;
  ranked: (PerfAgentView & { rank: number; confPerHour: number })[];
  unranked: (PerfAgentView & { reason: "no_activity" | "too_little_activity" })[];
  products: (PerfProduct & { rate: number | null; spread: ProductSpread | null })[];
  otherProducts: { treated: number; count: number };
}

export function buildPerformanceView(perf: TeamPerformance): PerformanceView {
  const days = localDaysBetween(perf.from, perf.to);
  const names: Record<string, string> = {};
  for (const a of perf.agents) names[a.agent_id] = a.name;

  const throughputs: number[] = [];
  const byId: Record<string, PerfAgentView> = {};
  for (const a of perf.agents) {
    const targets = targetsFor(perf.defaults, a.targets);
    const rate = a.treated >= MIN_TREATED_FOR_RATE ? rateOf(a.confirmed, a.treated) : null;
    const throughput = a.active_minutes > 0 ? Math.round((a.treated / (a.active_minutes / 60)) * 10) / 10 : null;
    if (throughput !== null && a.active_minutes >= 60) throughputs.push(throughput);
    const byDay = new Map(a.daily.map((d) => [d.day, d]));
    const heat = days.map((day) => byDay.get(day) ?? { day, active_minutes: 0, treated: 0, confirmed: 0 });
    const streak = computeGoalStreak(
      a.daily.map((d) => ({ treated: d.treated, confirmed: d.confirmed, overdueCallbacks: 0, staleUntouched: 0 })),
      targets,
    );
    const motifTotal = a.motifs.reduce((s, m) => s + m.n, 0);
    byId[a.agent_id] = {
      agent: a,
      targets,
      rate,
      throughput,
      confPerHour: confirmationsPerHour(a.confirmed, a.active_minutes),
      streak,
      coaching: null,
      heat,
      topMotif: a.motifs.length ? { ...a.motifs[0], total: motifTotal } : null,
    };
  }
  const medianThroughput = medianOf(throughputs);
  for (const v of Object.values(byId)) {
    v.coaching = suggestCoachingTarget(
      { rate: v.rate, throughput: v.throughput },
      { minRate: v.targets.minRate, medianThroughput: medianThroughput ?? 0 },
    );
  }

  const { ranked, unranked } = rankAgents(
    perf.agents.map((a) => ({ agentId: a.agent_id, confirmed: a.confirmed, activeMinutes: a.active_minutes, treated: a.treated })),
  );

  const products = perf.products
    .filter((p) => p.treated >= MIN_TREATED_FOR_RATE)
    .map((p) => ({ ...p, rate: rateOf(p.confirmed, p.treated), spread: productSpread(p.agents, names) }));
  const others = perf.products.filter((p) => p.treated < MIN_TREATED_FOR_RATE);

  const goalTarget = perf.defaults.team_weekly_conf;
  return {
    days,
    team: {
      treated: perf.team.treated,
      confirmed: perf.team.confirmed,
      rate: rateOf(perf.team.confirmed, perf.team.treated),
      activeMinutes: perf.team.active_minutes,
      medianThroughput,
      goal: { value: perf.team.confirmed, target: goalTarget, pct: goalTarget > 0 ? Math.min(100, Math.round((perf.team.confirmed / goalTarget) * 100)) : 0 },
      agentsActive: perf.team.agents_active,
      agentsTotal: perf.team.agents_total,
      confPerHourTarget: perf.defaults.conf_per_hour,
    },
    byId,
    ranked: ranked.map((r) => ({ ...byId[r.agentId], rank: r.rank, confPerHour: r.confPerHour })),
    unranked: unranked.map((u) => ({ ...byId[u.agentId], reason: u.reason })),
    products,
    otherProducts: { treated: others.reduce((s, p) => s + p.treated, 0), count: others.length },
  };
}

// ---------- live ----------

export interface LiveAgentView {
  agent: LiveAgent;
  targets: GoalTargets;
  goals: DailyGoalsResult;
}

export interface LiveView {
  verdict: { online: number; total: number; blocked: number; orphanAgents: number };
  agents: LiveAgentView[];
}

export function buildLiveView(live: TeamLive): LiveView {
  const agents = live.agents.map((a) => {
    const targets = targetsFor(live.defaults, a.targets);
    const goals = evaluateDailyGoals(
      {
        treated: a.today.treated,
        confirmed: a.today.confirmed,
        overdueCallbacks: a.queue.overdue_callbacks,
        staleUntouched: a.queue.stale_untouched,
      },
      targets,
    );
    return { agent: a, targets, goals };
  });
  return {
    verdict: {
      online: live.presence.online,
      total: live.presence.total,
      blocked: live.blocked_count,
      orphanAgents: live.tiles.orphan_queues.agents_count,
    },
    agents,
  };
}
