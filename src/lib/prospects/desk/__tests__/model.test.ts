import { describe, expect, it } from "vitest";
import { buildDesk } from "../model";
import type { AgentFacts, DeskFacts, SourceFacts } from "../types";

const NOW = new Date("2026-10-06T10:00:00Z");

const src = (key: SourceFacts["key"], over: Partial<SourceFacts> = {}): SourceFacts => ({
  key, created: 0, to_call: 0, in_progress: 0, won: 0, lost: 0, delivered: 0, revenue: 0, ...over,
});
const agent = (id: string, over: Partial<AgentFacts> = {}): AgentFacts => ({
  id, name: id, color: null, last_seen_at: null, in_rotation: true, file_open: 0, called_today: 0,
  late_callbacks: 0, stale: 0, converted_month: 0, delivered_month: 0, revenue_month: 0, ...over,
});
const facts = (over: Partial<DeskFacts> = {}): DeskFacts => ({
  generated_at: NOW.toISOString(),
  month: { from: "2026-10-01", to: "2026-10-31" },
  settings: {
    enabled: true,
    rej: { on: true, delay_days: 3, subreasons: [] },
    ret: { on: true },
    old: { on: true, after_days: 30 },
    dist: { hour: 9, file_cap: 15, release_days: 3, max_tries: 3 },
  },
  last_tick_at: "2026-10-06T07:00:00Z",
  hero: { delivered: 0, revenue: 0, converted: 0, on_road: 0, not_shipped: 0, returned: 0, prev_delivered: 0 },
  sources: [src("rej"), src("ret"), src("old"), src("camp")],
  agents: [],
  pool: { open: 0, oldest_days: null },
  open_total: 0,
  ...over,
});

describe("buildDesk — sources", () => {
  it("always returns the four sources in the page's order, even when SQL omits one", () => {
    const d = buildDesk(facts({ sources: [src("camp", { created: 3 }), src("rej")] }), NOW);
    expect(d.sources.map((s) => s.key)).toEqual(["rej", "ret", "old", "camp"]);
    expect(d.sources[3].created).toBe(3);
    expect(d.sources[1].created).toBe(0);
  });

  it("orders the bar brought back → in progress → to call → lost, with shares of the card's own total", () => {
    const d = buildDesk(facts({ sources: [src("rej", { created: 200, won: 20, in_progress: 40, to_call: 40, lost: 100 })] }), NOW);
    const segs = d.sources[0].segments;
    expect(segs.map((s) => s.key)).toEqual(["won", "in_progress", "to_call", "lost"]);
    expect(segs.map((s) => s.share)).toEqual([0.1, 0.2, 0.2, 0.5]);
  });

  it("gives every segment a share of 0 when the card is empty, never NaN", () => {
    const d = buildDesk(facts(), NOW);
    expect(d.sources[0].segments.every((s) => s.share === 0)).toBe(true);
  });
});

describe("buildDesk — hero", () => {
  it("reports the trend against last month only when last month had something", () => {
    expect(buildDesk(facts({ hero: { ...facts().hero, delivered: 23, prev_delivered: 14 } }), NOW).hero.trend).toBe(9);
    expect(buildDesk(facts({ hero: { ...facts().hero, delivered: 5, prev_delivered: 0 } }), NOW).hero.trend).toBeNull();
  });

  it("flags a month with nothing brought back yet", () => {
    expect(buildDesk(facts(), NOW).hero.empty).toBe(true);
    expect(buildDesk(facts({ hero: { ...facts().hero, converted: 1 } }), NOW).hero.empty).toBe(false);
  });
});

describe("buildDesk — agents", () => {
  it("sorts by delivered this month, then by name, and resolves a colour for everyone", () => {
    const d = buildDesk(facts({ agents: [agent("b", { delivered_month: 1 }), agent("a", { delivered_month: 3 }), agent("c", { delivered_month: 1 })] }), NOW);
    expect(d.agents.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(d.agents.every((a) => typeof a.colorKey === "string")).toBe(true);
  });

  it("is online when seen within the idle window", () => {
    const d = buildDesk(facts({ agents: [
      agent("on", { last_seen_at: "2026-10-06T09:45:00Z" }),
      agent("off", { last_seen_at: "2026-10-05T17:40:00Z" }),
      agent("never"),
    ] }), NOW);
    expect(d.agents.find((a) => a.id === "on")!.online).toBe(true);
    expect(d.agents.find((a) => a.id === "off")!.online).toBe(false);
    expect(d.agents.find((a) => a.id === "never")!.online).toBe(false);
  });

  it("raises one flag per card: untouched prospects outrank late callbacks", () => {
    const d = buildDesk(facts({ agents: [agent("x", { stale: 7, late_callbacks: 2 }), agent("y", { late_callbacks: 1 }), agent("z")] }), NOW);
    expect(d.agents.find((a) => a.id === "x")!.flag).toEqual({ kind: "stale", n: 7 });
    expect(d.agents.find((a) => a.id === "y")!.flag).toEqual({ kind: "late", n: 1 });
    expect(d.agents.find((a) => a.id === "z")!.flag).toBeNull();
  });

  it("uses the file cap as the ring's total when the agent's file is not full", () => {
    const d = buildDesk(facts({ agents: [agent("x", { file_open: 4, called_today: 2 })] }), NOW);
    expect(d.agents[0].ringTotal).toBe(15);
  });
});

describe("buildDesk — to-do", () => {
  it("names the market's own « untouched » delay, not a hardcoded one", () => {
    const d = buildDesk(facts({ settings: { ...facts().settings, dist: { ...facts().settings.dist, release_days: 5 } } }), NOW);
    expect(d.releaseDays).toBe(5);
  });

  it("is calm when nothing needs the manager", () => {
    const d = buildDesk(facts({ agents: [agent("x")] }), NOW);
    expect(d.todo).toEqual([]);
    expect(d.calm).toBe(true);
  });

  it("lists the pool first (bad), then untouched files per agent, then late callbacks grouped", () => {
    const d = buildDesk(facts({
      pool: { open: 12, oldest_days: 2 },
      agents: [agent("riheb", { stale: 7 }), agent("hend", { late_callbacks: 2 }), agent("mouna", { late_callbacks: 1 })],
    }), NOW);
    expect(d.todo.map((t) => t.kind)).toEqual(["pool", "stale", "late"]);
    expect(d.todo[0]).toMatchObject({ kind: "pool", severity: "bad", n: 12 });
    expect(d.todo[1]).toMatchObject({ kind: "stale", severity: "warn", n: 7, agentId: "riheb", agentName: "riheb" });
    expect(d.todo[2]).toMatchObject({ kind: "late", severity: "warn", n: 3, byAgent: [{ name: "hend", n: 2 }, { name: "mouna", n: 1 }] });
    expect(d.calm).toBe(false);
  });

  it("never alarms while the recovery engine is switched off for the market", () => {
    const d = buildDesk(facts({ settings: { ...facts().settings, enabled: false }, pool: { open: 1700, oldest_days: 150 } }), NOW);
    expect(d.todo.find((t) => t.kind === "pool")).toBeUndefined();
    expect(d.engineOff).toBe(true);
  });
});
