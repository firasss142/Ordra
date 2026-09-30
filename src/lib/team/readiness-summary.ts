import type { AgentCapacityRow } from "@/hooks/useAgentCapacity";

/**
 * What a manager needs to know about distribution at a glance.
 *
 * Pure: the control room renders it and the tests assert it, so there is no
 * second arithmetic anywhere that could disagree with the panel.
 */

export interface AgentReadiness {
  agent: AgentCapacityRow;
  /** Declared, beating, and therefore receiving. */
  ready: boolean;
  /**
   * Declared but the heartbeat has gone quiet. The distinction matters: this
   * agent believes they are working and is getting nothing.
   */
  stale: boolean;
  /** Orders they should hold by now, from their share of the day's volume. */
  target: number | null;
  /** assigned_today − target. Positive = ahead, negative = owed. */
  drift: number | null;
}

export interface ReadinessSummary {
  rows: AgentReadiness[];
  readyCount: number;
  staleCount: number;
  /** Total assigned across the market today — the quota's denominator. */
  distributedToday: number;
  /** True when no one can receive: every new order will sit in the pool. */
  nobodyReady: boolean;
  /** Shares are configured but do not total 100. */
  sharesIncomplete: boolean;
}

const SHARES_TOTAL = 100;

export function summariseReadiness(agents: AgentCapacityRow[]): ReadinessSummary {
  const distributedToday = agents.reduce((sum, a) => sum + (a.assigned_today ?? 0), 0);

  const configured = agents.filter((a) => a.share_pct !== null);
  const sharesTotal = configured.reduce((sum, a) => sum + (a.share_pct ?? 0), 0);
  const usesShares = configured.length > 0;

  const rows = agents
    .map((agent) => {
      const ready = agent.receiving_orders === true;
      const stale = agent.is_available === true && !ready;

      // Target only means something once the market actually uses shares AND
      // something has been distributed — otherwise every agent reads as "owed
      // 0 of 0", which looks like a verdict and is just an empty day.
      const target =
        agent.share_pct === null ? null : ((agent.share_pct / 100) * distributedToday);

      return {
        agent,
        ready,
        stale,
        target: target === null ? null : Math.round(target * 10) / 10,
        drift:
          target === null
            ? null
            : Math.round(((agent.assigned_today ?? 0) - target) * 10) / 10,
      };
    })
    // Who can take work first, then who is furthest behind — a manager reads
    // this list to decide who to call, not to admire an alphabet.
    .sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      if (a.stale !== b.stale) return a.stale ? -1 : 1;
      const ad = a.drift ?? 0;
      const bd = b.drift ?? 0;
      if (ad !== bd) return ad - bd;
      return (a.agent.full_name ?? "").localeCompare(b.agent.full_name ?? "");
    });

  return {
    rows,
    readyCount: rows.filter((r) => r.ready).length,
    staleCount: rows.filter((r) => r.stale).length,
    distributedToday,
    nobodyReady: rows.length > 0 && rows.every((r) => !r.ready),
    sharesIncomplete: usesShares && Math.round(sharesTotal * 100) / 100 !== SHARES_TOTAL,
  };
}
