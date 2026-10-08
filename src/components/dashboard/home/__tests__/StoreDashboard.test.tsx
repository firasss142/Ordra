import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { buildStoreDash, type BuildInput, type StoreRow } from "@/lib/dashboard/stores/build";
import { resolveDashWindow } from "@/lib/dashboard/stores/period";
import type { StoreOrder } from "@/lib/dashboard/stores/facts";
import type { StoreDashView } from "@/lib/dashboard/stores/view";

let view: StoreDashView;
let search = "";
vi.mock("swr", () => ({ default: () => ({ data: view, error: undefined, isLoading: false }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

import { StoreDashboard } from "../StoreDashboard";

const TODAY = "2026-10-04";
const store = (id: string, o: Partial<StoreRow> = {}): StoreRow => ({
  id,
  name: `Boutique ${id.toUpperCase()}`,
  platform: "shopify",
  sheet_adapter: null,
  is_active: true,
  accent_color: "indigo",
  last_webhook_status: null,
  last_webhook_error: null,
  webhook_failure_count: 0,
  sheet_failures: 0,
  sheet_failing_since: null,
  sheet_error: null,
  first_order_at: "2026-06-10T10:00:00Z",
  last_order_at: "2026-10-04T15:00:00Z",
  ...o,
});
let seq = 0;
const ord = (o: Partial<StoreOrder>): StoreOrder => ({
  id: `o${seq++}`,
  at: "",
  day: "2026-10-01",
  min: 600,
  store: "a",
  bk: "d",
  doneAt: null,
  upAt: null,
  price: 100,
  deliveryCost: 25,
  returnCost: 0,
  unmapped: false,
  tried: false,
  products: [],
  ...o,
});

function make(period: "today" | "yesterday" | "7d" | "90d", role: "owner" | "manager", stores: StoreRow[], A: StoreOrder[], H: StoreOrder[] = []): StoreDashView {
  const inp: BuildInput = {
    role,
    currency: "LYD",
    tz: "Africa/Tripoli",
    now: new Date(),
    today: TODAY,
    nowMin: 17 * 60 + 20,
    first: "2026-06-07",
    window: resolveDashWindow(period, null, null, TODAY, "2026-06-07"),
    A,
    P: [],
    H,
    stores,
    daily: new Map(),
    ads: {},
    productNames: new Map(),
    firstDayOf: (iso) => iso.slice(0, 10),
  };
  return buildStoreDash(inp);
}

const show = () =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <StoreDashboard marketId="m" marketName="Libye" userName="Super" locale="fr" tz="Africa/Tripoli" />
    </NextIntlClientProvider>,
  );

const many = (n: number, o: Partial<StoreOrder>) => Array.from({ length: n }, () => ord(o));
const h = fr.home;

describe("Accueil v9 — the two KPIs", () => {
  beforeEach(() => {
    search = "";
  });

  it("today: orders received and the CA, each with yesterday beside it", () => {
    view = make("today", "owner", [store("a")], many(4, { day: TODAY, price: 120 }), many(9, { day: "2026-10-03", price: 50 }));
    const { container } = show();
    expect(screen.getByText(h.kpi.orders)).toBeInTheDocument();
    expect(screen.getByText(h.kpi.ca)).toBeInTheDocument();
    const chips = [...container.querySelectorAll(".mchip")].map((x) => x.textContent);
    expect(chips[0]).toMatch(/Hier\s*9/);
    expect(chips[1]).toMatch(/Hier\s*450/);
    expect(container.querySelector(".k-ca .k-v")?.textContent).toMatch(/480/);
  });

  it("a manager reads the same page without a single amount", () => {
    view = make("today", "manager", [store("a")], many(4, { day: TODAY }));
    const { container } = show();
    expect(screen.queryByText(h.kpi.ca)).toBeNull();
    expect(container.querySelector(".hero.solo")).not.toBeNull();
    expect(screen.queryByText(h.brk.ca)).toBeNull();
  });

  it("a period shows the arrow and « Avant », and keeps the doors to Performance", () => {
    search = "period=7d";
    view = make("7d", "owner", [store("a")], many(30, { bk: "d" }));
    show();
    expect(screen.getAllByText(h.kpi.before).length).toBe(2);
    expect(screen.getByRole("link", { name: h.head.doorOrders })).toHaveAttribute("href", "/fr/performance/orders");
    expect(screen.getByRole("link", { name: h.head.doorTeam })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: h.head.doorDelivery })).toBeInTheDocument();
  });
});

describe("Accueil v9 — the breakdown", () => {
  beforeEach(() => {
    search = "period=7d";
  });

  it("one ranked list: every store once, shares adding up to 100", () => {
    view = make("7d", "owner", [store("a"), store("b"), store("c")], [...many(1, {}), ...many(1, { store: "b" }), ...many(1, { store: "c" })]);
    const { container } = show();
    const shares = [...container.querySelectorAll(".lrow .sh")].map((x) => parseInt(x.textContent ?? "0", 10));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    // the store card no longer repeats the share
    expect(screen.queryByText(/du total/)).toBeNull();
  });
});

describe("Accueil v9 — store cards", () => {
  it("a day: the four tiles in the order an order lives them, the gap said underneath", () => {
    search = "";
    view = make("today", "owner", [store("a")], [ord({ day: TODAY, bk: "c" }), ord({ day: TODAY, bk: "c", tried: true }), ord({ day: TODAY, bk: "u" }), ord({ day: TODAY, bk: "r" }), ord({ day: TODAY, bk: "x" })]);
    show();
    const a = screen.getByRole("button", { name: /Boutique A — ouvrir/ });
    const labels = [...a.querySelectorAll(".minis.four .mi")].map((x) => x.firstChild?.textContent);
    expect(labels).toEqual([h.card.wait, h.card.tried, h.card.up, h.card.rej]);
    expect(within(a).getByText(/\+ 1 confirmée, pas encore téléchargée/)).toBeInTheDocument();
  });

  it("a period: the delivered ring from 30 orders, three minis; under 30 it is too early", () => {
    search = "period=7d";
    view = make("7d", "owner", [store("a"), store("b")], [...many(30, { bk: "d" }), ...many(5, { store: "b", bk: "d" })]);
    show();
    const a = screen.getByRole("button", { name: /Boutique A — ouvrir/ });
    expect(within(a).getByRole("img", { name: /30 livrées/ })).toBeInTheDocument();
    expect(within(a).getByText(h.card.conf)).toBeInTheDocument();
    expect(within(a).getByText(h.card.ret)).toBeInTheDocument();
    expect(within(a).getByText(h.card.paid)).toBeInTheDocument();
    const b = screen.getByRole("button", { name: /Boutique B — ouvrir/ });
    expect(within(b).getByText(new RegExp(h.card.early))).toBeInTheDocument();
  });

  it("an uploaded logo replaces the initials; without one, the initials on the store colour", () => {
    search = "period=7d";
    view = make("7d", "owner", [store("a", { logo_url: "https://x/a.png" }), store("b", { name: "Kids Corner" })], [...many(3, {}), ...many(2, { store: "b" })]);
    const { container } = show();
    expect(container.querySelector('.sc img[src="https://x/a.png"]')).not.toBeNull();
    expect(screen.getAllByText("KC").length).toBeGreaterThan(0);
  });

  it("a store with nothing in the period folds into one line", () => {
    search = "period=7d";
    view = make("7d", "owner", [store("a"), store("z")], many(3, {}));
    show();
    expect(screen.getByText(/1 boutique sans commande sur la période/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Boutique Z — ouvrir/ })).toBeNull();
  });
});
