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
  products: [],
  ...o,
});

function make(period: "today" | "7d" | "90d", role: "owner" | "manager", stores: StoreRow[], A: StoreOrder[]): StoreDashView {
  const inp: BuildInput = {
    role,
    currency: "LYD",
    tz: "Africa/Tripoli",
    now: new Date("2026-10-04T15:20:00Z"),
    today: TODAY,
    nowMin: 17 * 60 + 20,
    first: "2026-06-07",
    window: resolveDashWindow(period, null, null, TODAY, "2026-06-07"),
    A,
    P: [],
    stores,
    daily: new Map(),
    ads: {},
    productNames: new Map(),
    money: role === "owner" ? { linesA: [], linesP: [], costs: {}, avgDeliveryCost: 25 } : null,
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

describe("Accueil — calm summary", () => {
  beforeEach(() => {
    search = "period=7d";
  });

  it("draws the bars and what the orders became (counts first), without the old busy blocks", () => {
    view = make("7d", "owner", [store("a")], [...many(20, { bk: "d" }), ...many(10, { bk: "x" }), ...many(10, { bk: "c" })]);
    show();
    expect(screen.getByRole("img", { name: fr.home.all.curveRange })).toBeInTheDocument();
    expect(screen.getByText(fr.home.out.title)).toBeInTheDocument();
    // counts first, the share in brackets — no « sur 100 »
    expect(screen.getAllByRole("img", { name: /20 livrées \(50\s%\) · 0 retournées \(0\s%\) · 10 rejetées \(25\s%\)/ })[0]).toBeInTheDocument();
    expect(screen.queryByText(/sur 100/)).toBeNull();
    expect(screen.queryByText(/Toutes les boutiques/)).toBeNull();
    expect(screen.queryByText(/Comment lire cette page/)).toBeNull();
    expect(screen.queryByText(/Trier/)).toBeNull();
  });

  it("the owner sees what customers paid and the profit; a manager does not", () => {
    view = make("7d", "owner", [store("a")], many(30, { bk: "d" }));
    const { unmount } = show();
    expect(screen.getByText("Chiffre d’affaires encaissé")).toBeInTheDocument();
    expect(screen.queryByText(/Payé par les clients/)).toBeNull();
    expect(screen.getByText(fr.home.tile.profit)).toBeInTheDocument();
    unmount();
    view = make("7d", "manager", [store("a")], many(30, { bk: "d" }));
    show();
    expect(screen.queryByText(fr.home.tile.profit)).toBeNull();
    expect(screen.queryByText("Chiffre d’affaires encaissé")).toBeNull();
  });

  it("with nothing to compare against, no arrow is drawn at all (no grey « — » pills)", () => {
    view = make("7d", "manager", [store("a")], many(40, { bk: "d" }));
    show();
    expect(screen.queryAllByText("—")).toHaveLength(0);
  });

  it("a platform with no logo file (BuyBox) falls back to the shop's initials", () => {
    view = make("7d", "owner", [store("a", { platform: "buybox", name: "Kids Corner" })], many(3, {}));
    show();
    expect(screen.getByText("KC")).toBeInTheDocument();
  });

  it("over three months the bars are weeks, not days", () => {
    search = "period=90d";
    view = make("90d", "owner", [store("a")], many(3, {}));
    show();
    expect(screen.getByRole("img", { name: fr.home.all.chartWeeks })).toBeInTheDocument();
  });

  it("keeps the shortcuts to Performance", () => {
    view = make("7d", "owner", [store("a")], many(5, {}));
    show();
    expect(screen.getByRole("link", { name: fr.home.all.doorOrders })).toHaveAttribute("href", "/fr/performance/orders");
    expect(screen.getByRole("link", { name: fr.home.all.doorTeam })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: fr.home.all.doorDelivery })).toBeInTheDocument();
  });

  it("today shows the calls, not an outcome bar", () => {
    search = "";
    view = make("today", "owner", [store("a")], many(4, { day: TODAY, bk: "c" }));
    show();
    expect(screen.getByRole("img", { name: fr.home.all.curveToday })).toBeInTheDocument();
    expect(screen.queryByText(fr.home.out.title)).toBeNull();
    expect(screen.getAllByText(fr.home.tile.toCall).length).toBeGreaterThan(0);
  });
});

describe("Accueil — lighter store cards", () => {
  beforeEach(() => {
    search = "period=7d";
  });

  it("a card shows the logo, a ring led by the delivered COUNT, three mini figures — and no silent-store line", () => {
    view = make(
      "7d",
      "owner",
      [store("a", { logo_url: "https://x/a.png" }), store("b"), store("z", { last_order_at: null })],
      [...many(30, { bk: "d" }), ...many(5, { store: "b", bk: "d" })],
    );
    const { container } = show();
    expect(container.querySelector('img[src="https://x/a.png"]')).not.toBeNull();
    expect(screen.getByText("Boutique A")).toBeInTheDocument();
    // no uploaded logo: the platform's own logo, never bare initials when one exists
    expect(container.querySelector('img[src="/platforms/shopify-mark.svg"]')).not.toBeNull();
    const a = screen.getByRole("button", { name: /Boutique A/ });
    expect(within(a).getByRole("img", { name: /30 livrées \(100\s%\)/ })).toBeInTheDocument();
    expect(within(a).getByText(fr.home.card.ringL)).toBeInTheDocument();
    expect(within(a).getByText(fr.home.card.confirmed)).toBeInTheDocument();
    expect(within(a).getByText(fr.home.card.returned)).toBeInTheDocument();
    expect(within(a).getByText(fr.home.card.paid)).toBeInTheDocument();
    // owner's order: the money first
    const labels = [...a.querySelectorAll(".mini small")].map((x) => x.textContent);
    expect(labels).toEqual([fr.home.card.paid, fr.home.card.confirmed, fr.home.card.returned]);
    // under 30 orders: no ring to read yet
    const b = screen.getByRole("button", { name: /Boutique B/ });
    expect(within(b).getByText(fr.home.card.earlyL)).toBeInTheDocument();
    expect(screen.queryByText("Boutique Z")).toBeNull();
  });
});
