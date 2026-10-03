/**
 * Salle de contrôle — the agents table: assigned → uploaded → delivered over a
 * period, ranked by « livrées pour 100 assignées », with a trend against the
 * previous period. The prototype's `view30()` (prototypes/team-v5.html).
 */
import { daysBetween, localDayMinute } from "./time";
import type { TeamFunnel } from "./types";

/** Below this many assigned orders a score is noise: shown, not ranked. */
export const MIN_SCORED = 30;
/** A rate this many points under the team's earns a « faible » tag. */
const WEAK_GAP = 5;
/** Silent this many days and the row says since when. */
const INACTIVE_DAYS = 7;

export interface FunnelRow {
  agentId: string;
  name: string;
  avatarUrl: string | null;
  isActive: boolean;
  assigned: number;
  uploaded: number;
  delivered: number;
  enRoute: number;
  returned: number;
  notUploaded: number;
  /** Delivered per 100 assigned. */
  score: number | null;
  /** Uploaded, % of assigned. */
  upl: number | null;
  /** Delivered, % of finished parcels (delivered + returned). */
  dlv: number | null;
  prevScore: number | null;
  /** Rounded score minus rounded previous score. */
  trend: number | null;
  scored: boolean;
  rank: number | null;
  weakUpl: boolean;
  weakDlv: boolean;
  balance: number;
  inactiveSince: string | null;
}

export interface FunnelView {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  team: {
    assigned: number;
    uploaded: number;
    delivered: number;
    enRoute: number;
    returned: number;
    notUploaded: number;
    score: number | null;
    upl: number | null;
    dlv: number | null;
    prevScore: number | null;
    trend: number | null;
  };
  rows: FunnelRow[];
  /** The biggest cohort — every bar is drawn on this scale. */
  max: number;
}

const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
const trendOf = (now: number | null, prev: number | null) =>
  now === null || prev === null ? null : Math.round(now) - Math.round(prev);

export function buildFunnelView(
  f: TeamFunnel,
  opts: { balances: Record<string, number>; today: string },
): FunnelView {
  const sum = (k: "assigned" | "uploaded" | "delivered" | "en_route" | "returned" | "prev_assigned" | "prev_delivered") =>
    f.agents.reduce((s, a) => s + (a[k] ?? 0), 0);

  const t = {
    assigned: sum("assigned"),
    uploaded: sum("uploaded"),
    delivered: sum("delivered"),
    enRoute: sum("en_route"),
    returned: sum("returned"),
  };
  const teamPrevAssigned = sum("prev_assigned");
  const teamScore = ratio(t.delivered, t.assigned);
  const teamPrev = teamPrevAssigned > 0 ? ratio(sum("prev_delivered"), teamPrevAssigned) : null;
  const team = {
    ...t,
    notUploaded: t.assigned - t.uploaded,
    score: teamScore,
    upl: ratio(t.uploaded, t.assigned),
    dlv: ratio(t.delivered, t.delivered + t.returned),
    prevScore: teamPrev,
    trend: trendOf(teamScore, teamPrev),
  };

  const rows: FunnelRow[] = f.agents
    .filter((a) => a.assigned > 0 || (opts.balances[a.agent_id] ?? 0) !== 0)
    .map((a) => {
      const scored = a.assigned >= MIN_SCORED;
      const score = ratio(a.delivered, a.assigned);
      const prevScore = a.prev_assigned >= MIN_SCORED ? ratio(a.prev_delivered, a.prev_assigned) : null;
      const upl = ratio(a.uploaded, a.assigned);
      const dlv = ratio(a.delivered, a.delivered + a.returned);
      const lastDay = a.last_action_at ? localDayMinute(a.last_action_at, f.tz).day : null;
      return {
        agentId: a.agent_id,
        name: a.name,
        avatarUrl: a.avatar_url,
        isActive: a.is_active,
        assigned: a.assigned,
        uploaded: a.uploaded,
        delivered: a.delivered,
        enRoute: a.en_route,
        returned: a.returned,
        notUploaded: a.assigned - a.uploaded,
        score,
        upl,
        dlv,
        prevScore,
        trend: scored ? trendOf(score, prevScore) : null,
        scored,
        rank: null,
        weakUpl: scored && upl !== null && team.upl !== null && upl <= team.upl - WEAK_GAP,
        weakDlv: scored && dlv !== null && team.dlv !== null && dlv <= team.dlv - WEAK_GAP,
        balance: opts.balances[a.agent_id] ?? 0,
        inactiveSince: lastDay && daysBetween(lastDay, opts.today) > INACTIVE_DAYS ? lastDay : null,
      };
    });

  rows.sort(
    (x, y) =>
      Number(y.scored) - Number(x.scored) ||
      (y.score ?? 0) - (x.score ?? 0) ||
      y.assigned - x.assigned ||
      x.name.localeCompare(y.name),
  );
  let k = 0;
  for (const r of rows) r.rank = r.scored ? ++k : null;

  return {
    from: f.from,
    to: f.to,
    prevFrom: f.prev_from,
    prevTo: f.prev_to,
    team,
    rows,
    max: Math.max(0, ...rows.map((r) => r.assigned)),
  };
}
