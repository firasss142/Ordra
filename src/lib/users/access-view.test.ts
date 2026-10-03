import { describe, it, expect } from "vitest";
import {
  accessStatus,
  activityOf,
  buildAccessView,
  identifierFromUsername,
  loginIdentifier,
  roleTabsFor,
  showsIdentifier,
  type AccessFilters,
} from "./access-view";
import { accessUser, TN, TRIPOLI } from "@/test/helpers/accessUsers";

/* Local wall-clock times, so day boundaries hold in any test timezone. */
const NOW = new Date(2026, 9, 3, 15, 30);
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const ALL: AccessFilters = { tab: "all", market: "all", query: "", dormantOnly: false };

describe("accessStatus", () => {
  it("is active, invited (inactive with an unanswered invitation) or disabled", () => {
    expect(accessStatus(accessUser({ full_name: "a" }))).toBe("active");
    expect(accessStatus(accessUser({ full_name: "b", is_active: false, invitation_sent_at: at(2, 18) }))).toBe("invited");
    expect(accessStatus(accessUser({ full_name: "c", is_active: false }))).toBe("disabled");
    expect(
      accessStatus(accessUser({ full_name: "d", is_active: false, invitation_sent_at: at(1, 9), invitation_accepted_at: at(1, 10) })),
    ).toBe("disabled");
  });
});

describe("the login identifier", () => {
  it("is what the person types: the address without @oms.local", () => {
    expect(loginIdentifier("agent1.tn@oms.local")).toBe("agent1.tn");
    expect(loginIdentifier("testagent88@test.com")).toBe("testagent88@test.com");
  });

  it("is derived from a username the way the API and the login screen derive it", () => {
    expect(identifierFromUsername("  Ahmed  Ben Ali ")).toBe("ahmed.ben.ali");
  });

  it("is repeated under the name only when the name does not already spell it", () => {
    expect(showsIdentifier(accessUser({ full_name: "roqaya" }))).toBe(false);
    expect(showsIdentifier(accessUser({ full_name: "firas hadj ameur" }))).toBe(false);
    expect(showsIdentifier(accessUser({ full_name: "Agent TN 1", email: "agent1.tn@oms.local" }))).toBe(true);
    expect(showsIdentifier(accessUser({ full_name: "Super Admin", email: "admin@oms.tn" }))).toBe(true);
  });
});

describe("activityOf", () => {
  it("follows the console's presence lines, then hours, yesterday, the weekday and a date", () => {
    expect(activityOf(at(3, 15, 26), NOW)).toEqual({ kind: "online" });
    expect(activityOf(at(3, 15, 18), NOW)).toEqual({ kind: "idle", minutes: 12 });
    expect(activityOf(at(3, 14, 48), NOW)).toEqual({ kind: "minutes", minutes: 42 });
    expect(activityOf(at(3, 2, 48), NOW)).toEqual({ kind: "hours", hours: 12 });
    expect(activityOf(at(2, 23, 10), NOW)).toEqual({ kind: "yesterday", at: new Date(at(2, 23, 10)) });
  });

  it("names the weekday inside a week and the date beyond it", () => {
    expect(activityOf(new Date(2026, 9, 1, 19, 15).toISOString(), NOW)).toEqual({ kind: "weekday", at: new Date(2026, 9, 1, 19, 15) });
    expect(activityOf(new Date(2026, 3, 29, 17, 58).toISOString(), NOW)).toEqual({ kind: "date", at: new Date(2026, 3, 29, 17, 58) });
  });

  it("says so when there is no recorded activity", () => {
    expect(activityOf(null, NOW)).toEqual({ kind: "none" });
  });
});

describe("roleTabsFor", () => {
  it("gives a super admin every role, agents first, and a manager only their two", () => {
    expect(roleTabsFor("super_admin")).toEqual(["all", "agent", "warehouse_agent", "market_manager", "investor", "super_admin"]);
    expect(roleTabsFor("market_manager")).toEqual(["all", "agent", "warehouse_agent"]);
  });
});

describe("buildAccessView", () => {
  const tasnim = accessUser({ full_name: "tasnim", last_seen_at: at(3, 15, 26) });
  const roqaya = accessUser({ full_name: "roqaya", last_seen_at: at(3, 13, 45) });
  const mouna = accessUser({ full_name: "mouna" });
  const asma = accessUser({ full_name: "asma", market_id: TN });
  const nour = accessUser({ full_name: "nour", is_active: false, invitation_sent_at: at(2, 18) });
  const gone = accessUser({ full_name: "Agent 1 TN", email: "agent1.tn@oms.test", market_id: TN, is_active: false });
  const adel = accessUser({ full_name: "adel", role: "warehouse_agent", warehouse_id: TRIPOLI, last_seen_at: at(3, 2, 48) });
  const tarek = accessUser({ full_name: "tarek", role: "warehouse_agent" });
  const hamid = accessUser({ full_name: "hamidaly", role: "market_manager", last_seen_at: at(3, 13, 56) });
  const admin = accessUser({ full_name: "Super Admin", email: "admin@oms.tn", role: "super_admin", market_id: null, last_seen_at: at(3, 15, 28) });
  const users = [mouna, gone, adel, admin, roqaya, asma, nour, hamid, tarek, tasnim];

  it("sorts by role (agents first), online before idle, most recent activity first, never-seen and invitations last", () => {
    const v = buildAccessView(users, "super_admin", ALL, NOW);
    expect(v.rows.map((u) => u.full_name)).toEqual(["tasnim", "roqaya", "asma", "mouna", "nour", "adel", "tarek", "hamidaly", "Super Admin"]);
  });

  it("folds disabled accounts away from the list", () => {
    const v = buildAccessView(users, "super_admin", ALL, NOW);
    expect(v.disabled.map((u) => u.full_name)).toEqual(["Agent 1 TN"]);
  });

  it("counts each tile on live accounts, with who is online and the first three faces", () => {
    const v = buildAccessView(users, "super_admin", ALL, NOW);
    const tile = (r: string) => v.tiles.find((t) => t.role === r)!;
    expect(tile("all")).toMatchObject({ count: 9, online: 2 });
    expect(tile("agent")).toMatchObject({ count: 5, online: 1 });
    expect(tile("agent").faces.map((u) => u.full_name)).toEqual(["tasnim", "roqaya", "asma"]);
    expect(tile("warehouse_agent")).toMatchObject({ count: 2, online: 0 });
    expect(tile("investor")).toMatchObject({ count: 0 });
  });

  it("filters by tile, by market and by name or identifier", () => {
    expect(buildAccessView(users, "super_admin", { ...ALL, tab: "warehouse_agent" }, NOW).rows.map((u) => u.full_name)).toEqual(["adel", "tarek"]);
    expect(buildAccessView(users, "super_admin", { ...ALL, market: "tn" }, NOW).rows.map((u) => u.full_name)).toEqual(["asma"]);
    expect(buildAccessView(users, "super_admin", { ...ALL, query: "  ROQ " }, NOW).rows.map((u) => u.full_name)).toEqual(["roqaya"]);
    expect(buildAccessView(users, "super_admin", { ...ALL, query: "agent1.tn" }, NOW).disabled.map((u) => u.full_name)).toEqual(["Agent 1 TN"]);
  });

  it("counts markets on the current tile, and the super admin's own row belongs to neither market", () => {
    const v = buildAccessView(users, "super_admin", ALL, NOW);
    expect(v.marketCounts).toEqual({ all: 9, tn: 1, ly: 7 });
  });

  it("narrows to active accounts with no recorded activity, and hides the disabled fold meanwhile", () => {
    const v = buildAccessView(users, "super_admin", { ...ALL, dormantOnly: true }, NOW);
    expect(v.dormantCount).toBe(3);
    expect(v.rows.map((u) => u.full_name)).toEqual(["asma", "mouna", "tarek"]);
    expect(v.disabled).toEqual([]);
  });

  it("lists active warehouse agents with no building whatever the filters", () => {
    const v = buildAccessView(users, "super_admin", { ...ALL, tab: "agent", market: "tn" }, NOW);
    expect(v.unassignedWarehouse.map((u) => u.full_name)).toEqual(["tarek"]);
  });

  it("ignores the market filter for a manager, whose list the API already scoped", () => {
    const v = buildAccessView([tasnim, adel], "market_manager", { ...ALL, market: "tn" }, NOW);
    expect(v.rows).toHaveLength(2);
    expect(v.tiles.map((t) => t.role)).toEqual(["all", "agent", "warehouse_agent"]);
  });
});
