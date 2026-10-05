import { describe, it, expect } from "vitest";
import {
  NAV_GROUPS,
  TOP_ITEMS,
  visibleNav,
  isNavItemActive,
  findActiveGroupId,
  groupBadgeSource,
  flattenNav,
} from "./sidebar-nav";

const keys = (role: Parameters<typeof visibleNav>[0]) => {
  const nav = visibleNav(role);
  return {
    top: nav.top.map((i) => i.key),
    groups: nav.groups.map((g) => [g.id, g.items.map((i) => i.key)] as const),
  };
};

describe("visibleNav", () => {
  it("puts Dashboard on its own, above every group — a one-link group was two rows and a fold", () => {
    expect(TOP_ITEMS.map((i) => i.key)).toEqual(["pulse"]);
    expect(NAV_GROUPS.some((g) => (g.id as string) === "accueil")).toBe(false);
  });

  it("gives a super_admin the eight groups, in the order of the working day", () => {
    expect(keys("super_admin")).toEqual({
      top: ["pulse"],
      groups: [
        ["commandes", ["orders", "archived", "duplicates"]],
        ["logistique", ["warehouseToday", "warehouseOut", "warehouseReturns", "warehouseStock"]],
        ["livraison", ["deliveryWorklist"]],
        ["performance", ["perfOrders", "perfTeam", "perfDelivery"]],
        ["finances", ["pnl", "productsMargins", "stockInventory", "purchases", "adSpend", "investors"]],
        ["clients", ["activeProspects", "customerVoice", "messages"]],
        ["equipe", ["controlRoom", "access"]],
        ["systeme", ["reglages", "logs"]],
      ],
    });
  });

  it("gathers the analytics in one « Performance » group, for managers too (plans/performance-commandes.md)", () => {
    const perf = keys("market_manager").groups.find(([id]) => id === "performance");
    expect(perf?.[1]).toEqual(["perfOrders", "perfTeam", "perfDelivery"]);
    const hrefs = NAV_GROUPS.find((g) => g.id === "performance")!.items.map((i) => i.href);
    expect(hrefs).toEqual(["performance/orders", "team/performance", "carriers"]);
  });

  it("shows a market_manager Finances › Produits & marges and Achats only — never the P&L, Stock, Pub or Investisseurs", () => {
    const nav = keys("market_manager");
    expect(nav.groups.find(([id]) => id === "finances")?.[1]).toEqual(["productsMargins", "purchases"]);
  });

  it("hides Journaux from a market_manager", () => {
    const nav = keys("market_manager");
    expect(nav.groups.find(([id]) => id === "systeme")?.[1]).toEqual(["reglages"]);
  });

  it("no longer lists the two retired boards — Transporteurs replaced them", () => {
    const all = flattenNav(visibleNav("super_admin")).map((e) => e.item.key);
    expect(all).not.toContain("inDeliveryBoard");
    expect(all).not.toContain("carrierTracking");
  });

  it("gives no sidebar entries to the roles that have their own shell", () => {
    for (const role of ["agent", "warehouse_agent", "investor"] as const) {
      expect(visibleNav(role)).toEqual({ top: [], groups: [] });
    }
  });

  it("uses every icon once — a truck, a gauge and a box each meant two things", () => {
    const icons = [
      ...NAV_GROUPS.map((g) => g.icon),
      ...TOP_ITEMS.map((i) => i.icon),
      ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.icon)),
    ];
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("never prices the P&L in dollars — the markets count in TND and LYD", () => {
    const pnl = flattenNav(visibleNav("super_admin")).find((e) => e.item.key === "pnl");
    expect(pnl?.item.icon.displayName).not.toBe("DollarSign");
  });
});

describe("isNavItemActive", () => {
  const item = (key: string) => flattenNav(visibleNav("super_admin")).find((e) => e.item.key === key)!.item;

  it("matches the exact path, whatever filters the URL carries", () => {
    expect(isNavItemActive(item("orders"), "fr", "/fr/orders", "?preset=unassigned")).toBe(true);
    expect(isNavItemActive(item("pulse"), "fr", "/fr/dashboard/stock", "")).toBe(false);
  });

  it("keeps an item active on the sub-pages it declares", () => {
    expect(isNavItemActive(item("warehouseOut"), "fr", "/fr/warehouse/scan", "")).toBe(true);
    expect(isNavItemActive(item("warehouseStock"), "fr", "/fr/warehouse/count", "")).toBe(true);
    expect(isNavItemActive(item("messages"), "fr", "/fr/messages/templates", "")).toBe(true);
    expect(isNavItemActive(item("reglages"), "fr", "/fr/system/settings/delivery", "")).toBe(true);
  });
});

describe("findActiveGroupId", () => {
  const nav = visibleNav("super_admin");
  it("finds the group of the current page", () => {
    expect(findActiveGroupId(nav, "fr", "/fr/dashboard/pnl", "")).toBe("finances");
    expect(findActiveGroupId(nav, "fr", "/fr/orders", "?preset=unassigned")).toBe("commandes");
    expect(findActiveGroupId(nav, "fr", "/fr/warehouse/stock/p1", "")).toBe("logistique");
  });

  it("answers null on Dashboard, which belongs to no group", () => {
    expect(findActiveGroupId(nav, "fr", "/fr/dashboard", "")).toBeNull();
  });
});

describe("groupBadgeSource", () => {
  const group = (id: string) => NAV_GROUPS.find((g) => g.id === id)!;
  it("lifts a hidden count onto its group, unassigned first", () => {
    expect(groupBadgeSource(group("commandes"), { unassigned: 4, whatsapp: 0, journal: 0 })).toBe("unassigned");
    expect(groupBadgeSource(group("clients"), { unassigned: 4, whatsapp: 2, journal: 0 })).toBe("whatsapp");
    expect(groupBadgeSource(group("systeme"), { unassigned: 0, whatsapp: 0, journal: 1 })).toBe("journal");
  });

  it("says nothing when nothing waits", () => {
    expect(groupBadgeSource(group("commandes"), { unassigned: 0, whatsapp: 0, journal: 0 })).toBeNull();
  });
});
