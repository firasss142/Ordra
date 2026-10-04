/**
 * « Aujourd'hui » — the four jobs of a warehouse day, in the order they happen:
 * send out (Sortir), take back (Rentrer), receive (Recevoir), count (Compter).
 *
 * Pure: the server function that reads the database (`day-loop-server.ts`)
 * builds a `DayCounts` per building and hands it here. Every rule that decides
 * what a figure MEANS lives in this file and is tested; the SQL only counts.
 *
 * Why this screen is not the « Aujourd'hui » deleted on 2026-09-08: that one was
 * a KPI dashboard that repeated the other screens' figures and whose actions
 * could not be clicked. Here each job carries one number — the size of its
 * backlog — and is the only door to its work.
 */

export type DayJobKey = "out" | "returns" | "receive" | "count";

/**
 * `never` is its own state, not a big `work`: on 2026-10-02 no product had ever
 * been counted, so every stock figure was the register alone. "Two products are
 * due" and "nothing has ever been verified" ask for different reactions.
 */
export type DayJobState = "work" | "idle" | "never";

/** What one building (or the whole market, once summed) has waiting. */
export interface DayCounts {
  /** On the bench: `uploaded`, ours, not set aside. */
  toPrepare: number;
  /** Age of the oldest parcel on the bench, in hours. */
  oldestHours: number;
  /** `uploaded` but cleared off the bench — still counted everywhere else. */
  setAside: number;
  /** `to_be_returned`: Darb holds it for us, scannable. */
  returnsAtCarrier: number;
  /** `returning`: on its way, not receivable yet (strict-returns rule). */
  returnsOnTheWay: number;
  /**
   * Open arrival groups: counted on the dock, not yet settled by the office.
   * Stock is already on the shelf; its margin is not known yet. That is the
   * accepted price of the 3 October inversion, and it must stay visible.
   */
  receptionsOpen: number;
  /** …of which opened before today — unpriced stock that is ageing. */
  receptionsLate: number;
  /** Active products of the market. */
  products: number;
  /** …that no physical count has ever covered (for this building, or anywhere). */
  neverCounted: number;
}

export interface DayJob {
  key: DayJobKey;
  count: number;
  state: DayJobState;
}

export interface DayProgress {
  done: number;
  target: number;
  pct: number;
  /** True when `target` is the market's own goal rather than today's workload. */
  hasGoal: boolean;
}

export interface DayLoop {
  jobs: DayJob[];
  progress: DayProgress;
}

function job(key: DayJobKey, count: number): DayJob {
  return { key, count, state: count > 0 ? "work" : "idle" };
}

export function buildDayLoop(input: {
  counts: DayCounts;
  scannedToday: number;
  /** `goal_daily_scanned`. Null when the market never set one — never a default. */
  goal: number | null;
}): DayLoop {
  const { counts, scannedToday, goal } = input;

  const count: DayJob = job("count", counts.neverCounted);
  if (counts.products > 0 && counts.neverCounted >= counts.products) count.state = "never";

  const hasGoal = goal !== null && goal > 0;
  const target = hasGoal ? (goal as number) : scannedToday + counts.toPrepare;
  const pct = target > 0 ? Math.min(100, Math.round((scannedToday / target) * 100)) : 0;

  return {
    jobs: [
      job("out", counts.toPrepare),
      job("returns", counts.returnsAtCarrier),
      job("receive", counts.receptionsOpen),
      count,
    ],
    progress: { done: scannedToday, target, pct, hasGoal },
  };
}

/**
 * The market seen across its buildings.
 *
 * Queue figures add up; the oldest parcel is the oldest of the oldest, not a
 * sum of ages. The catalogue belongs to the market, so `products` and
 * `neverCounted` come from the caller — a product is uncounted for the market
 * only when NO building counted it, which a sum cannot know.
 */
export function sumSiteCounts(
  sites: DayCounts[],
  market: { products: number; neverCounted: number },
): DayCounts {
  const total: DayCounts = {
    toPrepare: 0,
    oldestHours: 0,
    setAside: 0,
    returnsAtCarrier: 0,
    returnsOnTheWay: 0,
    receptionsOpen: 0,
    receptionsLate: 0,
    products: market.products,
    neverCounted: market.neverCounted,
  };
  for (const s of sites) {
    total.toPrepare += s.toPrepare;
    total.oldestHours = Math.max(total.oldestHours, s.oldestHours);
    total.setAside += s.setAside;
    total.returnsAtCarrier += s.returnsAtCarrier;
    total.returnsOnTheWay += s.returnsOnTheWay;
    total.receptionsOpen += s.receptionsOpen;
    total.receptionsLate += s.receptionsLate;
  }
  return total;
}

export type DecisionKey =
  | "setAside"
  | "returns"
  | "receptionsLate"
  | "neverCounted";

/** Where the decision is acted on: a warehouse screen, never a dead end. */
export type DecisionTarget = "out" | "returns" | "receptions" | "count";

export interface Decision {
  key: DecisionKey;
  count: number;
  severity: "critical" | "warning";
  target: DecisionTarget;
}

/**
 * The manager's « À décider ». Every line is clickable and lands where the
 * decision is taken — the old dashboard's priority actions were not.
 */
export function buildDecisions(c: DayCounts): Decision[] {
  const out: Decision[] = [];
  // Set aside is critical: those parcels are still `uploaded`, so they count as
  // engaged stock and as shipments in every other figure, yet nobody will scan
  // them. 351 of them sat at Tripoli on 2026-10-02, 323 for a dead carrier.
  if (c.setAside > 0) out.push({ key: "setAside", count: c.setAside, severity: "critical", target: "out" });
  if (c.returnsAtCarrier > 0) {
    out.push({ key: "returns", count: c.returnsAtCarrier, severity: "warning", target: "returns" });
  }
  // UN SEUL MOTIF D'ALERTE SUR LES RÉCEPTIONS. « Sans ligne » a disparu avec
  // les brouillons : `record_arrival` crée le groupe AVEC son premier comptage,
  // donc un groupe vide n'existe plus. Une carte qui ne peut jamais s'allumer
  // est du bruit qu'on finit par ne plus lire.
  if (c.receptionsLate > 0) {
    out.push({ key: "receptionsLate", count: c.receptionsLate, severity: "warning", target: "receptions" });
  }
  if (c.neverCounted > 0) {
    out.push({ key: "neverCounted", count: c.neverCounted, severity: "warning", target: "count" });
  }
  return out;
}

export interface TeamAgent {
  id: string;
  name: string;
  warehouseId: string | null;
}

export interface TeamScanRow {
  actorId: string;
  scanned: number;
  lastScanAt: string | null;
}

export interface TeamRow extends TeamAgent {
  scannedToday: number;
  lastScanAt: string | null;
}

/**
 * Today's team: every warehouse agent, scans or not. An agent missing from the
 * leaderboard is the most important row on it — a building that has not scanned
 * today — so absence becomes a zero instead of disappearing. Managers who
 * happened to scan are not agents and stay off the list.
 */
export function buildTeam(agents: TeamAgent[], scans: TeamScanRow[]): TeamRow[] {
  const byActor = new Map(scans.map((s) => [s.actorId, s]));
  return agents
    .map((a) => {
      const s = byActor.get(a.id);
      return { ...a, scannedToday: s?.scanned ?? 0, lastScanAt: s?.lastScanAt ?? null };
    })
    .sort((x, y) => y.scannedToday - x.scannedToday);
}
