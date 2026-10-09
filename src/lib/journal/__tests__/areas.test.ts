import { describe, expect, test } from "vitest";
import { issueArea, rowArea } from "../areas";
import type { FeedRow, Issue, SystemTile } from "../types";

/**
 * Journaux v3 sorts everything into six areas (prototypes/journaux-v3.html):
 * the Catégorie column, the Catégorie filter and the row icon all read them.
 */

const issue = (over: Partial<Issue>): Issue => ({
  id: "i",
  rule: "server_error",
  severity: "warning",
  system: "app",
  params: {},
  first_seen: "2026-10-01T00:00:00Z",
  last_seen: "2026-10-01T00:00:00Z",
  affected: null,
  amount: null,
  currency: null,
  status: "open",
  muted_until: null,
  market: null,
  ...over,
});

const row = (over: Partial<FeedRow>): FeedRow => ({
  at: "2026-10-01T00:00:00Z",
  id: "x",
  family: "team",
  kind: "order.status",
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

describe("issueArea", () => {
  test("a problem takes the area of the system it is attached to", () => {
    const systems = [{ id: "whatsapp", family: "msg" } as SystemTile];
    expect(issueArea(issue({ system: "whatsapp", rule: "whatsapp_down" }), systems)).toBe("msg");
  });

  test("without a matching tile, the system id says it", () => {
    expect(issueArea(issue({ system: "jobs", rule: "job_hanging" }), [])).toBe("auto");
    expect(issueArea(issue({ system: "carrier:c-1", rule: "carrier_inactive" }), [])).toBe("carrier");
    expect(issueArea(issue({ system: "shop:s-1", rule: "import_rows" }), [])).toBe("intake");
    expect(issueArea(issue({ system: "app", rule: "server_error" }), [])).toBe("app");
  });

  test("and failing that, the rule", () => {
    expect(issueArea(issue({ system: "??", rule: "ads_no_orders" }), [])).toBe("ads");
    expect(issueArea(issue({ system: "??", rule: "login_failures" }), [])).toBe("app");
    expect(issueArea(issue({ system: "??", rule: "upload_failing" }), [])).toBe("carrier");
  });
});

describe("rowArea", () => {
  test("carrier work is Livraison; a Meta sync is Publicité", () => {
    expect(rowArea(row({ family: "ext", kind: "carrier.upload_failed" }))).toBe("carrier");
    expect(rowArea(row({ kind: "delivery.call_customer" }))).toBe("carrier");
    expect(rowArea(row({ family: "ext", kind: "sync.failed", params: { system: "Meta" } }))).toBe("ads");
    expect(rowArea(row({ family: "ext", kind: "sync.failed", params: { system: "Darb Tripoli" } }))).toBe("carrier");
  });

  test("orders, shops, products and stock are Commandes", () => {
    expect(rowArea(row({ kind: "order.status" }))).toBe("intake");
    expect(rowArea(row({ family: "ext", kind: "intake.imported" }))).toBe("intake");
    expect(rowArea(row({ kind: "storefronts.updated" }))).toBe("intake");
    expect(rowArea(row({ kind: "products.updated" }))).toBe("intake");
    expect(rowArea(row({ kind: "stock.manual_adjustment" }))).toBe("intake");
  });

  test("an audited table sends the row to its own area", () => {
    expect(rowArea(row({ kind: "carriers.updated" }))).toBe("carrier");
    expect(rowArea(row({ kind: "whatsapp_templates.created" }))).toBe("msg");
    expect(rowArea(row({ kind: "ad_spend.updated" }))).toBe("ads");
    expect(rowArea(row({ kind: "users.updated" }))).toBe("app");
  });

  test("security, sign-ins and settings are Application; jobs are Tâches automatiques", () => {
    expect(rowArea(row({ family: "sec", kind: "app.error" }))).toBe("app");
    expect(rowArea(row({ family: "sec", kind: "auth.login" }))).toBe("app");
    expect(rowArea(row({ kind: "settings.changed" }))).toBe("app");
    expect(rowArea(row({ family: "auto", kind: "job.failed" }))).toBe("auto");
    expect(rowArea(row({ family: "auto", kind: "commission.accrual" }))).toBe("auto");
  });

  test("a problem line follows its rule", () => {
    expect(rowArea(row({ family: "auto", kind: "issue.opened", params: { rule: "job_hanging" } }))).toBe("auto");
    expect(rowArea(row({ family: "ext", kind: "issue.opened", params: { rule: "import_rows" } }))).toBe("intake");
    expect(rowArea(row({ family: "ext", kind: "issue.opened", params: { rule: "whatsapp_down" } }))).toBe("msg");
  });
});
