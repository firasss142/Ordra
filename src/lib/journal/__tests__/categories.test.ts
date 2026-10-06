import { describe, test, expect } from "vitest";
import { CATEGORIES, categoryOfIssue, categoryOfRow, feedQueryFor, summarise } from "../categories";
import type { FeedRow, Issue, SystemTile } from "../types";

const issue = (over: Partial<Issue>): Issue => ({
  id: "i",
  rule: "job_failing",
  severity: "critical",
  system: "jobs",
  params: {},
  first_seen: "2026-10-06T00:00:00Z",
  last_seen: "2026-10-06T00:00:00Z",
  affected: null,
  amount: null,
  currency: null,
  status: "open",
  muted_until: null,
  market: null,
  ...over,
});

const tile = (family: SystemTile["family"], state: SystemTile["state"]): SystemTile => ({
  id: `${family}:${state}`,
  family,
  kind: family,
  name: null,
  market: null,
  state,
  reason: "",
  last_at: null,
  detail: {},
  issue_ids: [],
  bars: null,
});

const row = (over: Partial<FeedRow>): FeedRow => ({
  at: "2026-10-06T10:00:00Z",
  id: "r",
  family: "ext",
  kind: "carrier.status",
  severity: null,
  actor_id: null,
  actor_name: null,
  actor_role: null,
  market_id: null,
  order_id: null,
  order_ref: null,
  params: {},
  ref: null,
  ...over,
});

describe("one categorisation for the whole Journaux page", () => {
  test("six areas of the business, in the order a manager thinks of them", () => {
    expect(CATEGORIES).toEqual(["intake", "carrier", "ads", "msg", "auto", "app"]);
  });

  test("a problem belongs to the area of the system it is about", () => {
    expect(categoryOfIssue(issue({ system: "jobs" }))).toBe("auto");
    expect(categoryOfIssue(issue({ rule: "carrier_stuck", system: "carrier:c-navex" }))).toBe("carrier");
    expect(categoryOfIssue(issue({ rule: "import_rows", system: "shop:s1" }))).toBe("intake");
    expect(categoryOfIssue(issue({ rule: "whatsapp_down", system: "whatsapp" }))).toBe("msg");
    expect(categoryOfIssue(issue({ rule: "server_error", system: "app" }))).toBe("app");
    expect(categoryOfIssue(issue({ rule: "external_failing", system: "meta" }))).toBe("ads");
  });

  test("« ads running, no orders » is an advertising problem even though it is filed under the shops", () => {
    expect(categoryOfIssue(issue({ rule: "ads_no_orders", system: "shops" }))).toBe("ads");
  });

  test("an unknown system is never lost: it lands in Application", () => {
    expect(categoryOfIssue(issue({ rule: "external_failing", system: "something-new" }))).toBe("app");
  });

  test("each area is summarised: urgent, to watch, connected systems, healthy ones — « not connected » is not « healthy »", () => {
    const s = summarise(
      [issue({ id: "a", rule: "carrier_stuck", system: "carrier:x" }), issue({ id: "b", rule: "carrier_inactive", system: "carrier:y", severity: "warning" }), issue({ id: "m", system: "carrier:z", status: "muted" })],
      [tile("carrier", "fail"), tile("carrier", "ok"), tile("carrier", "off"), tile("auto", "ok")],
    );
    expect(s.carrier).toEqual({ urgent: 1, watch: 1, systems: 2, healthy: 1 });
    expect(s.auto).toEqual({ urgent: 0, watch: 0, systems: 1, healthy: 1 });
    expect(s.msg).toEqual({ urgent: 0, watch: 0, systems: 0, healthy: 0 });
  });

  test("a history row is filed in the same areas, people's actions under « Équipe »", () => {
    expect(categoryOfRow(row({ family: "team", kind: "order.status" }))).toBe("team");
    expect(categoryOfRow(row({ family: "ext", kind: "carrier.upload_failed" }))).toBe("carrier");
    expect(categoryOfRow(row({ family: "ext", kind: "intake.imported" }))).toBe("intake");
    expect(categoryOfRow(row({ family: "ext", kind: "sync.failed", params: { system: "Meta" } }))).toBe("ads");
    expect(categoryOfRow(row({ family: "auto", kind: "job.failed" }))).toBe("auto");
    expect(categoryOfRow(row({ family: "sec", kind: "auth.login" }))).toBe("app");
    expect(categoryOfRow(row({ family: "ext", kind: "issue.opened", params: { rule: "whatsapp_down" } }))).toBe("msg");
  });

  test("the history asks the server for the narrowest family, and filters the rest on screen", () => {
    expect(feedQueryFor("all")).toEqual({ family: null, local: false });
    expect(feedQueryFor("team")).toEqual({ family: "team", local: false });
    expect(feedQueryFor("auto")).toEqual({ family: "auto", local: false });
    expect(feedQueryFor("app")).toEqual({ family: "sec", local: false });
    expect(feedQueryFor("carrier")).toEqual({ family: "ext", local: true });
    expect(feedQueryFor("intake")).toEqual({ family: "ext", local: true });
  });
});
