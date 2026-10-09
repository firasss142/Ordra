/**
 * Facts → the Prospects desk. Pure; every rule the page applies lives here.
 *
 * Design: prototypes/prospects-manager-v5.html. Owner's figure choices
 * (2026-10-05): no KPI row; headline = brought back AND delivered; source card
 * = where its prospects are; agent card = today + this month; health = to-do
 * lines only when non-zero.
 */
import { agentColorKey } from "@/lib/team/agent-color";
import type { AgentColorKey } from "@/lib/team/room/types";
import { IDLE_THRESHOLD_MS } from "@/lib/presence";
import { DESK_SOURCES, type AgentFacts, type DeskFacts, type DeskSource, type DeskState } from "./types";

export interface Segment { key: DeskState; n: number; share: number }

export interface SourceCard {
  key: DeskSource;
  created: number;
  segments: Segment[];
  won: number;
  delivered: number;
  revenue: number;
}

export interface AgentCard extends AgentFacts {
  colorKey: AgentColorKey;
  online: boolean;
  /** The one warning her card wears. Untouched prospects outrank late callbacks. */
  flag: { kind: "stale" | "late"; n: number } | null;
  /** The ring's denominator: her file, or the cap when her file is not full. */
  ringTotal: number;
}

export type TodoItem =
  | { kind: "pool"; severity: "bad"; n: number; oldestDays: number | null }
  | { kind: "stale"; severity: "warn"; n: number; agentId: string; agentName: string; online: boolean }
  | { kind: "late"; severity: "warn"; n: number; byAgent: { id: string; name: string; n: number }[] };

export interface DeskView {
  hero: DeskFacts["hero"] & { trend: number | null; empty: boolean };
  sources: SourceCard[];
  agents: AgentCard[];
  todo: TodoItem[];
  calm: boolean;
  /** The market's engine is off: no automatic sources, no alarms. */
  engineOff: boolean;
  fileCap: number;
  /** « Sans appel depuis N jours » — what « intouchés » means in this market. */
  releaseDays: number;
  lastTickAt: string | null;
  openTotal: number;
}

/** The bar reads from the good news to the bad: brought back first, lost last. */
const SEGMENT_ORDER: DeskState[] = ["won", "in_progress", "to_call", "lost"];

const round = (x: number) => Math.round(x * 1000) / 1000;

export function buildDesk(facts: DeskFacts, now: Date = new Date()): DeskView {
  const byKey = new Map(facts.sources.map((s) => [s.key, s]));
  const sources: SourceCard[] = DESK_SOURCES.map((key) => {
    const s = byKey.get(key);
    const created = s?.created ?? 0;
    const counts: Record<DeskState, number> = {
      won: s?.won ?? 0, in_progress: s?.in_progress ?? 0, to_call: s?.to_call ?? 0, lost: s?.lost ?? 0,
    };
    const total = SEGMENT_ORDER.reduce((sum, k) => sum + counts[k], 0);
    return {
      key,
      created,
      won: counts.won,
      delivered: s?.delivered ?? 0,
      revenue: s?.revenue ?? 0,
      segments: SEGMENT_ORDER.map((k) => ({ key: k, n: counts[k], share: total ? round(counts[k] / total) : 0 })),
    };
  });

  const cap = facts.settings.dist.file_cap;
  const agents: AgentCard[] = facts.agents
    .map((a) => ({
      ...a,
      colorKey: agentColorKey(a.color, a.id),
      online: a.last_seen_at !== null && now.getTime() - Date.parse(a.last_seen_at) < IDLE_THRESHOLD_MS,
      flag: a.stale > 0 ? { kind: "stale" as const, n: a.stale } : a.late_callbacks > 0 ? { kind: "late" as const, n: a.late_callbacks } : null,
      ringTotal: Math.max(cap, a.file_open, a.called_today),
    }))
    .sort((x, y) => y.delivered_month - x.delivered_month || x.name.localeCompare(y.name));

  const engineOff = !facts.settings.enabled;
  const todo: TodoItem[] = [];
  if (!engineOff && facts.pool.open > 0) {
    todo.push({ kind: "pool", severity: "bad", n: facts.pool.open, oldestDays: facts.pool.oldest_days });
  }
  for (const a of agents) {
    if (a.stale > 0) todo.push({ kind: "stale", severity: "warn", n: a.stale, agentId: a.id, agentName: a.name, online: a.online });
  }
  const late = agents.filter((a) => a.late_callbacks > 0)
    .sort((x, y) => y.late_callbacks - x.late_callbacks)
    .map((a) => ({ id: a.id, name: a.name, n: a.late_callbacks }));
  if (late.length) todo.push({ kind: "late", severity: "warn", n: late.reduce((s, a) => s + a.n, 0), byAgent: late });

  const h = facts.hero;
  return {
    hero: { ...h, trend: h.prev_delivered > 0 ? h.delivered - h.prev_delivered : null, empty: h.delivered === 0 && h.converted === 0 },
    sources,
    agents,
    todo,
    calm: todo.length === 0,
    engineOff,
    fileCap: cap,
    releaseDays: facts.settings.dist.release_days,
    lastTickAt: facts.last_tick_at,
    openTotal: facts.open_total,
  };
}
