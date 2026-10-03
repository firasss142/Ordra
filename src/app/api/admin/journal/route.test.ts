import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";

let db: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET as overview } from "./overview/route";
import { GET as feed } from "./feed/route";
import { GET as trace } from "./trace/route";
import { GET as counts } from "./counts/route";
import { GET as detail } from "./detail/route";
import { POST as mute } from "./issues/[id]/mute/route";

const url = (path: string) => new NextRequest(new URL(`http://localhost/api/admin/journal${path}`));
const denied = Object.assign(new Error("Journaux : réservé au super_admin"), { code: "42501" });

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "sa-1", role: "super_admin", market_id: null });
  db = makeFakeSupabase({});
});

/**
 * The Journaux API is a thin door onto the SECURITY DEFINER read functions:
 * super_admin only, parameters checked before they reach SQL, a database
 * refusal answered as 403 rather than a 500 that would page the journal itself.
 */
describe("who may read", () => {
  test.each([
    ["overview", () => overview(url("/overview"))],
    ["feed", () => feed(url("/feed"))],
    ["trace", () => trace(url("/trace?q=2165688"))],
    ["counts", () => counts(url("/counts"))],
    ["detail", () => detail(url("/detail?ref=audit:x"))],
  ])("%s: a market manager gets 403 and no query runs", async (_n, call) => {
    setTestActor({ role: "market_manager", market_id: "m-1" });
    const spy = vi.fn();
    db.rpcs.journal_overview = spy;
    db.rpcs.journal_feed = spy;
    const res = await call();
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  test("no session → 401", async () => {
    setTestActor(null);
    expect((await overview(url("/overview"))).status).toBe(401);
  });

  test("the database refusing (42501) is a 403, not a 500", async () => {
    db.rpcs.journal_overview = () => {
      throw denied;
    };
    expect((await overview(url("/overview"))).status).toBe(403);
  });
});

describe("GET /overview", () => {
  test("returns what journal_overview returns", async () => {
    const data = { issues: [], systems: [{ id: "app" }], jobs: [], security: {}, generated_at: "x" };
    db.rpcs.journal_overview = () => data;
    const res = await overview(url("/overview"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(data);
  });
});

describe("GET /feed", () => {
  const rows = [
    { at: "2026-10-03T14:00:00Z", id: "oh:2", family: "team", kind: "order.status", severity: null, params: {} },
    { at: "2026-10-02T09:00:00Z", id: "oh:1", family: "team", kind: "order.status", severity: null, params: {} },
  ];

  test("passes the filters through and pages by the last row", async () => {
    const calls: Record<string, unknown>[] = [];
    db.rpcs.journal_feed = (a) => (calls.push(a), rows);
    db.rpcs.journal_routine = () => [];
    const res = await feed(url("/feed?family=sec&only_issues=1&market=00000000-0000-0000-0000-000000000002&limit=2"));
    const body = await res.json();
    expect(calls[0]).toMatchObject({ p_family: "sec", p_only_issues: true, p_market: "00000000-0000-0000-0000-000000000002", p_limit: 2 });
    expect(body.rows).toHaveLength(2);
    expect(body.next).toEqual({ before: "2026-10-02T09:00:00Z", beforeId: "oh:1" });
  });

  test("a short page has no next", async () => {
    db.rpcs.journal_feed = () => rows;
    db.rpcs.journal_routine = () => [];
    const body = await (await feed(url("/feed?limit=50"))).json();
    expect(body.next).toBeNull();
  });

  test("routine passes are counted for the span the page covers, per day", async () => {
    const calls: Record<string, unknown>[] = [];
    db.rpcs.journal_feed = () => rows;
    db.rpcs.journal_routine = (a) => (calls.push(a), [{ day: "2026-10-03", passes: 312 }, { day: "2026-10-02", passes: 40 }]);
    const body = await (await feed(url("/feed?tz=Africa/Tripoli&before=2026-10-03T16:00:00Z&before_id=oh:9"))).json();
    expect(calls[0]).toMatchObject({ p_from: "2026-10-02T09:00:00Z", p_to: "2026-10-03T16:00:00Z", p_tz: "Africa/Tripoli" });
    expect(body.routine).toEqual({ "2026-10-03": 312, "2026-10-02": 40 });
  });

  test("an unknown chip or a malformed cursor is a 400, never reaches SQL", async () => {
    const spy = vi.fn(() => []);
    db.rpcs.journal_feed = spy;
    expect((await feed(url("/feed?family=everything"))).status).toBe(400);
    expect((await feed(url("/feed?before=yesterday"))).status).toBe(400);
    expect((await feed(url("/feed?market=ly"))).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("GET /trace", () => {
  test("one match: the order's trace comes with it", async () => {
    db.rpcs.journal_find_order = () => [{ id: "o-1", ref: "2165688", status: "delivered", market: "ly", created_at: "x" }];
    db.rpcs.journal_order_trace = (a) => ({ order: { id: a.p_order_id }, events: [] });
    const body = await (await trace(url("/trace?q=2165688"))).json();
    expect(body.matches).toHaveLength(1);
    expect(body.trace).toEqual({ order: { id: "o-1" }, events: [] });
  });

  test("several matches: the list, no trace yet", async () => {
    db.rpcs.journal_find_order = () => [{ id: "o-1" }, { id: "o-2" }];
    const body = await (await trace(url("/trace?q=2165688"))).json();
    expect(body.matches).toHaveLength(2);
    expect(body.trace).toBeNull();
  });

  test("by order id", async () => {
    db.rpcs.journal_order_trace = (a) => ({ order: { id: a.p_order_id }, events: [] });
    const body = await (await trace(url("/trace?order_id=7f0f1d3e-0000-4000-8000-000000000001"))).json();
    expect(body.trace.order.id).toBe("7f0f1d3e-0000-4000-8000-000000000001");
  });

  test("nothing to look for is a 400", async () => {
    expect((await trace(url("/trace"))).status).toBe(400);
  });
});

describe("GET /counts", () => {
  test("the sidebar badge", async () => {
    db.rpcs.journal_counts = () => ({ open: 5, critical: 3 });
    expect(await (await counts(url("/counts"))).json()).toEqual({ open: 5, critical: 3 });
  });
});

describe("POST /issues/[id]/mute", () => {
  const post = (id: string, body: unknown) =>
    mute(new NextRequest(new URL(`http://localhost/api/admin/journal/issues/${id}/mute`), { method: "POST", body: JSON.stringify(body) }), {
      params: { id },
    });
  const ID = "6b0f1d3e-0000-4000-8000-000000000001";

  test("mutes for the days asked", async () => {
    const calls: Record<string, unknown>[] = [];
    db.rpcs.journal_issue_mute = (a) => (calls.push(a), null);
    expect((await post(ID, { days: 7 })).status).toBe(200);
    expect(calls[0]).toEqual({ p_issue_id: ID, p_days: 7 });
  });

  test("days outside 1–90 or a bad id are a 400", async () => {
    db.rpcs.journal_issue_mute = vi.fn();
    expect((await post(ID, { days: 0 })).status).toBe(400);
    expect((await post(ID, { days: 365 })).status).toBe(400);
    expect((await post("nope", { days: 7 })).status).toBe(400);
  });
});

describe("GET /detail", () => {
  test("an audit event: its before → after", async () => {
    db.tables.audit_events = [{ id: "5a0f1d3e-0000-4000-8000-000000000001", action: "products.updated", changes: { default_price: [199, 179] } }];
    const body = await (await detail(url("/detail?ref=audit:5a0f1d3e-0000-4000-8000-000000000001"))).json();
    expect(body).toMatchObject({ type: "audit", row: { changes: { default_price: [199, 179] } } });
  });

  test("a settings batch: every setting saved that minute by that person", async () => {
    db.tables.settings_history = [
      { id: "h1", market_id: "m-tn", key: "auto_archive_after_days", old_value: null, new_value: { value: 30 }, changed_by: "u-1", changed_at: "2026-08-21T15:47:10Z" },
      { id: "h2", market_id: "m-tn", key: "max_attempts", old_value: 3, new_value: 4, changed_by: "u-1", changed_at: "2026-08-21T15:47:40Z" },
      { id: "h3", market_id: "m-tn", key: "x", old_value: 1, new_value: 2, changed_by: "u-1", changed_at: "2026-08-21T15:48:01Z" },
      { id: "h4", market_id: "m-tn", key: "y", old_value: 1, new_value: 2, changed_by: "u-2", changed_at: "2026-08-21T15:47:20Z" },
    ];
    const body = await (await detail(url("/detail?ref=settings:u-1:m-tn:202608211547"))).json();
    expect(body.type).toBe("settings");
    expect(body.rows.map((r: { key: string }) => r.key)).toEqual(["auto_archive_after_days", "max_attempts"]);
  });

  test("an unknown reference is a 400", async () => {
    expect((await detail(url("/detail?ref=drop:table"))).status).toBe(400);
    expect((await detail(url("/detail?ref=audit:not-a-uuid"))).status).toBe(400);
  });
});
