import { describe, test, expect } from "vitest";
import { buildFunnelView, MIN_SCORED } from "./funnel-view";
import type { FunnelAgent, TeamFunnel } from "./types";

function fa(o: Partial<FunnelAgent> & { agent_id: string }): FunnelAgent {
  return {
    name: o.agent_id,
    avatar_url: null,
    is_active: true,
    last_action_at: "2026-10-02T12:00:00Z",
    assigned: 0,
    uploaded: 0,
    delivered: 0,
    en_route: 0,
    returned: 0,
    open: 0,
    prev_assigned: 0,
    prev_delivered: 0,
    ...o,
  };
}

// The prototype's 30-day Libya numbers (prototypes/team-v5.html, F30 / F30_PREV).
const FUNNEL: TeamFunnel = {
  market_id: "ly",
  from: "2026-09-03",
  to: "2026-10-02",
  prev_from: "2026-08-04",
  prev_to: "2026-09-02",
  tz: "Africa/Tripoli",
  agents: [
    fa({ agent_id: "tasnim", assigned: 555, uploaded: 248, delivered: 144, en_route: 11, returned: 86, open: 16, prev_assigned: 285, prev_delivered: 66 }),
    fa({ agent_id: "salima", assigned: 475, uploaded: 197, delivered: 76, en_route: 16, returned: 102, open: 8, prev_assigned: 269, prev_delivered: 38 }),
    fa({ agent_id: "roqaya", assigned: 342, uploaded: 101, delivered: 48, en_route: 11, returned: 38, open: 7, prev_assigned: 152, prev_delivered: 19 }),
    fa({ agent_id: "hend", assigned: 137, uploaded: 39, delivered: 15, en_route: 0, returned: 24, open: 1, prev_assigned: 88, prev_delivered: 15, last_action_at: "2026-09-16T12:00:00Z" }),
    fa({ agent_id: "mouna", assigned: 3, uploaded: 3, delivered: 2, returned: 1 }),
    fa({ agent_id: "riheb", prev_assigned: 51, prev_delivered: 11, last_action_at: "2026-09-12T12:00:00Z" }),
    fa({ agent_id: "ghost" }),
  ],
};

const BAL = { tasnim: 363, salima: 432, roqaya: 407, hend: 126, riheb: 60, mouna: 0, ghost: 0 };
const v = buildFunnelView(FUNNEL, { balances: BAL, today: "2026-10-02" });
const row = (id: string) => v.rows.find((r) => r.agentId === id)!;

describe("the agents table", () => {
  test("scores are delivered per 100 assigned, ranked from 30 assigned", () => {
    expect(MIN_SCORED).toBe(30);
    expect(v.rows.filter((r) => r.rank).map((r) => [r.agentId, r.rank, Math.round(r.score!)])).toEqual([
      ["tasnim", 1, 26],
      ["salima", 2, 16],
      ["roqaya", 3, 14],
      ["hend", 4, 11],
    ]);
    expect(row("mouna").scored).toBe(false);
    expect(row("mouna").rank).toBeNull();
  });

  test("the trend compares rounded scores with the previous period (prototype: ▲3 ▲2 ▲1 ▼6)", () => {
    expect(["tasnim", "salima", "roqaya", "hend"].map((a) => row(a).trend)).toEqual([3, 2, 1, -6]);
    expect(row("mouna").trend).toBeNull();
  });

  test("the team line sums everyone, with its own trend", () => {
    expect(v.team.assigned).toBe(1512);
    expect(v.team.delivered).toBe(285);
    expect(Math.round(v.team.score!)).toBe(19);
    expect(v.team.trend).toBe(1);
  });

  test("upload rate is of assigned; delivery rate is of finished parcels", () => {
    expect(Math.round(row("tasnim").upl!)).toBe(45);
    expect(Math.round(row("tasnim").dlv!)).toBe(63); // 144 / (144 + 86)
    expect(row("tasnim").notUploaded).toBe(555 - 248);
  });

  test("an agent with no orders and no balance is left out; one with a balance stays", () => {
    expect(v.rows.some((r) => r.agentId === "ghost")).toBe(false);
    expect(row("riheb").assigned).toBe(0);
    expect(row("riheb").balance).toBe(60);
  });

  test("weak links: 5 points under the team on upload or on delivery", () => {
    // team upload 588/1512 = 39 %, delivery 285/(285+251) = 53 %
    expect(row("roqaya").weakUpl).toBe(true);
    expect(row("salima").weakDlv).toBe(true);
    expect(row("tasnim").weakUpl || row("tasnim").weakDlv).toBe(false);
  });

  test("silent for more than 7 days is said, with the date", () => {
    expect(row("hend").inactiveSince).toBe("2026-09-16");
    expect(row("tasnim").inactiveSince).toBeNull();
  });

  test("bars share one scale: the biggest cohort", () => {
    expect(v.max).toBe(555);
  });
});
