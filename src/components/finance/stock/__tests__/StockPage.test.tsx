import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { buildStockView, type StockInput } from "@/lib/finance/stock/model";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/fr/dashboard/stock",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { StockPage } from "../StockPage";

const LY = "00000000-0000-0000-0000-000000000002";
const input: StockInput = {
  today: "2026-10-04",
  windowDays: 28,
  leadTimeDays: 14,
  sites: [{ id: "tri", name: "Tripoli" }, { id: "bgz", name: "Benghazi" }],
  products: [
    { id: "tad", name: "Tadabbur", image: null, cost: 62, price: 210, units: 290, rate: 5.9, daysSinceSale: 0, lastCounted: null, series: [3, 4, 5] },
    { id: "gan", name: "Gants de boxe", image: null, cost: 38, price: 150, units: 80, rate: 0.2, daysSinceSale: 9, lastCounted: null, series: [0, 1, 0] },
    { id: "tap", name: "Tapis de prière", image: null, cost: 55, price: 190, units: 66, rate: 0, daysSinceSale: 61, lastCounted: null, series: [0, 0, 0] },
  ],
  siteUnits: [
    { product: "tad", site: "tri", units: 210 },
    { product: "tad", site: "bgz", units: 60 },
    { product: "gan", site: "tri", units: 80 },
    { product: "tap", site: "tri", units: 52 },
  ],
  siteShipped: [
    { product: "tad", site: "tri", units: 67 },
    { product: "tad", site: "bgz", units: 98 },
    { product: "gan", site: "tri", units: 6 },
  ],
  onOrder: [],
};

const calls: string[] = [];
beforeEach(() => {
  nav.search = "";
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ ...buildStockView(input), today: "2026-10-04", windowDays: 28, leadTimeDays: 14, seriesBucketDays: 1, currency: "LYD" }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const norm = (s: string | null | undefined) => (s ?? "").replace(/[⁦⁩]/g, "").replace(/[\s  ]+/g, " ").trim();

function mount(marketId: string | null = LY) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <StockPage marketId={marketId} marketName="Libye" locale="fr" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("Stock & inventaire", () => {
  test("the money in stock, one block per warehouse, and the unplaced line", async () => {
    mount();
    await waitFor(() => expect(norm(document.querySelector(".hero-n")?.textContent)).toBe("24 650د.ل"));
    expect(screen.getByRole("heading", { name: "Tripoli" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Benghazi" })).toBeTruthy();
    expect(norm(document.querySelector(".unas .t")!.textContent)).toMatch(/^2 010 د.ل · 2 produits pas encore dans un entrepôt/);
  });

  test("a warehouse says what to rebuy, and the button opens a pre-filled order in Achats", async () => {
    mount();
    const bgz = (await screen.findByRole("heading", { name: "Benghazi" })).closest("section")!;
    const buy = within(bgz).getByRole("link", { name: /^Commander 150/ });
    expect(buy.getAttribute("href")).toBe("/fr/finance/purchases?new=po&site=bgz&product=tad&qty=150");
  });

  test("a product opens its drawer, per warehouse", async () => {
    mount();
    const tri = (await screen.findByRole("heading", { name: "Tripoli" })).closest("section")!;
    fireEvent.click(within(tri).getAllByText("Gants de boxe")[0]);
    const dlg = await screen.findByRole("dialog", { name: "Gants de boxe" });
    expect(within(dlg).getByText("Par entrepôt")).toBeTruthy();
    expect(within(dlg).getByText("jamais")).toBeTruthy();
  });

  test("the sales window reloads the page on 7 days", async () => {
    mount();
    await screen.findByRole("heading", { name: "Tripoli" });
    fireEvent.click(screen.getByRole("tab", { name: "7 j" }));
    await waitFor(() => expect(calls.some((c) => c.includes("window=7"))).toBe(true));
  });

  test("« Tous les marchés » asks for a market", () => {
    mount(null);
    expect(screen.getByText("Choisissez un marché")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
