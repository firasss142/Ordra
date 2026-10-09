import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { DayLoopRows } from "@/lib/warehouse/day-loop-assemble";

/**
 * GET /api/warehouse/today — who may read the day, and about which building.
 *
 * The figures themselves are tested in day-loop(-assemble).test.ts. Here: the
 * route's own decisions — the role gate, an agent PINNED to their building
 * whatever the query says, an unassigned agent shown nothing, a manager free
 * to narrow, and the manager-only views withheld from an agent.
 */

const actor = { id: "a", role: "warehouse_agent", market_id: "00000000-0000-0000-0000-000000000002" };
let currentActor: typeof actor | null = actor;
let userSite: string | null = "B";

vi.mock("@/lib/auth/actor", () => ({
  getActor: vi.fn(async () =>
    currentActor
      ? { actor: currentActor }
      : { response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) },
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { warehouse_id: userSite } }) }),
      }),
    }),
  })),
}));

const fetchRows = vi.fn();
vi.mock("@/lib/warehouse/day-loop-server", () => ({
  fetchDayLoopRows: (...args: unknown[]) => fetchRows(...args),
  marketToday: () => "2026-10-02",
}));

import { GET } from "./route";

function rows(): DayLoopRows {
  return {
    warehouses: [
      { id: "T", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس" },
      { id: "B", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي" },
    ],
    queueBySite: { T: { to_prepare: 1 }, B: { to_prepare: 31 } },
    marketQueue: { to_prepare: 32 },
    returning: [],
    receptions: [],
    productIds: ["p1"],
    countRows: [],
    agents: [{ id: "a", full_name: "adel", warehouse_id: "B" }],
    leaderboard: [],
    marketScannedToday: 0,
    goal: null,
  };
}

function req(qs = "") {
  return new NextRequest(new URL(`http://localhost/api/warehouse/today${qs}`));
}

beforeEach(() => {
  currentActor = actor;
  userSite = "B";
  fetchRows.mockReset();
  fetchRows.mockResolvedValue(rows());
});

describe("GET /api/warehouse/today", () => {
  it("answers 401 without a session", async () => {
    currentActor = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("refuses a call-centre agent", async () => {
    currentActor = { ...actor, role: "agent" };
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("pins a warehouse agent to their own building, whatever the query asks", async () => {
    const res = await GET(req("?warehouse_id=T"));
    const json = await res.json();
    expect(json.focus).toBe("B");
    expect(json.counts.toPrepare).toBe(31);
  });

  it("withholds the team and the decisions from an agent", async () => {
    const json = await (await GET(req())).json();
    expect(json.team).toEqual([]);
    expect(json.decisions).toEqual([]);
    expect(json.sites).toEqual([]);
  });

  it("shows an unassigned agent nothing, and says why", async () => {
    userSite = null;
    const json = await (await GET(req())).json();
    expect(json.siteUnassigned).toBe(true);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("lets a manager see the whole market, split by building", async () => {
    currentActor = { ...actor, id: "m", role: "market_manager" };
    const json = await (await GET(req())).json();
    expect(json.focus).toBeNull();
    expect(json.counts.toPrepare).toBe(32);
    expect(json.sites).toHaveLength(2);
  });

  it("lets a manager narrow to one building", async () => {
    currentActor = { ...actor, id: "m", role: "market_manager" };
    const json = await (await GET(req("?warehouse_id=T"))).json();
    expect(json.focus).toBe("T");
    expect(json.counts.toPrepare).toBe(1);
  });

  it("reads a manager's own market, never one passed in the query", async () => {
    currentActor = { ...actor, id: "m", role: "market_manager" };
    await GET(req("?market_id=00000000-0000-0000-0000-000000000001"));
    expect(fetchRows.mock.calls[0][1]).toMatchObject({ marketId: actor.market_id });
  });

  // The desk paints its first frame in the READER's language and SWR refreshes it from here:
  // a French super-admin on Libya saw « Tripoli » turn into « طرابلس » a moment after load.
  it("names the buildings in the language the page was painted in, when told", async () => {
    currentActor = { ...actor, id: "m", role: "market_manager" };
    const fr = await (await GET(req("?locale=fr"))).json();
    expect(fr.sites.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["Tripoli", "Benghazi"]));
    const plain = await (await GET(req())).json();
    expect(plain.sites.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["طرابلس", "بنغازي"]));
  });
});
