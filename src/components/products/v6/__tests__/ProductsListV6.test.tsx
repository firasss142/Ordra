import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { ToastProvider } from "@/components/ui/Toast";
import type { ProductOverviewRow, ProductsOverviewResponse } from "@/types/product-overview";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/fr/products",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const scope = vi.hoisted(() => ({ marketId: "00000000-0000-0000-0000-000000000002" as string | null }));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: scope.marketId }) }));

import { ProductsListV6 } from "../ProductsListV6";

const NOW = new Date("2026-10-03T18:00:00Z");
const NB = /[  ⁦⁩]/g;
const norm = (s: string | null | undefined) => (s ?? "").replace(NB, (c) => (c === "⁦" || c === "⁩" ? "" : " "));

function row(over: Partial<ProductOverviewRow> & { id: string; name: string }): ProductOverviewRow {
  return {
    sku: null,
    image_url: null,
    is_active: true,
    default_price: 249,
    current_stock: 100,
    low_stock_threshold: 5,
    counts: { received: 0, rejected: 0, deleted: 0, cancelled: 0, calling: 0, to_upload: 0, uploaded: 0, delivered: 0, failed: 0, in_flight: 0, withdrawn: 0 },
    confirmation: null,
    delivery: null,
    provisional: false,
    money: { deliveries: 0, paid: 0, carrier: 0, encaisse: 0, cogs: 0, packing: 0, processing: 0, ads: 0, net: 0 },
    margin: null,
    shares: [],
    spark: [0, 0, 0],
    units_left_30d: 0,
    cover: null,
    signal: null,
    ...over,
  };
}

const QR = row({
  id: "qr",
  name: "القرآن تدبر وعمل",
  sku: "qr-01",
  current_stock: 943,
  counts: { received: 581, rejected: 370, deleted: 47, cancelled: 0, calling: 5, to_upload: 1, uploaded: 158, delivered: 77, failed: 63, in_flight: 8, withdrawn: 10 },
  confirmation: 158 / 528,
  delivery: 77 / 140,
  money: { deliveries: 77, paid: 19173, carrier: 1816.269, encaisse: 17356.731, cogs: 3080, packing: 77.84, processing: 0, ads: 10566.192, net: 3632.699 },
  margin: 3632.699 / 17356.731,
  shares: [
    { key: "carrier", share: 0.095, amount: 1816 },
    { key: "cogs", share: 0.16, amount: 3080 },
    { key: "ads", share: 0.55, amount: 10566 },
    { key: "profit", share: 0.19, amount: 3632 },
  ],
  spark: [2, 16, 41],
  units_left_30d: 158,
  cover: 179,
});
const DA2 = row({
  id: "da2",
  name: "كتاب الداء والدواء",
  sku: "DA2",
  current_stock: 104,
  counts: { received: 492, rejected: 186, deleted: 35, cancelled: 0, calling: 9, to_upload: 0, uploaded: 262, delivered: 128, failed: 118, in_flight: 9, withdrawn: 7 },
  confirmation: 262 / 448,
  delivery: 128 / 246,
  money: { deliveries: 128, paid: 25233, carrier: 2806, encaisse: 22427, cogs: 3456, packing: 0, processing: 0, ads: 6678, net: 12292 },
  margin: 12292 / 22427,
  cover: 11.9,
  units_left_30d: 263,
  signal: "restock",
});
const DOLL = row({ id: "doll", name: "دميه ملاكمه حجم صغير", sku: "box-wafra-shop", signal: "nosales" });
const OLD = row({ id: "xx", name: "XX", is_active: false });

function overview(): ProductsOverviewResponse {
  return {
    period: { from: "2026-09-04", to: "2026-10-03", tz: "Africa/Tripoli", days: ["2026-09-04", "2026-09-05", "2026-09-06"] },
    currency: "LYD",
    lead_days: 14,
    market: { last_order_at: "2026-09-29T15:30:00Z", last_ad_day: "2026-09-29", any_counted: false, avg_delivery_cost: 22.8 },
    totals: {
      active: 3, received: 1073, uploaded: 420, rejected: 556, delivered: 205, failed: 181, in_flight: 17,
      paid: 44406, carrier: 4622.269, encaisse: 39783.731, ads: 17244.192, net: 15924.699,
      confirmation: 420 / 976, delivery: 205 / 386, margin: 0.4, final: 0.97, spark: [22, 49, 80],
    },
    rows: [QR, DA2, DOLL, OLD],
  };
}

function installApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/products/overview")) {
        return new Response(JSON.stringify(overview()), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

function renderList(role: "super_admin" | "market_manager" = "super_admin") {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli" now={NOW}>
        <ToastProvider>
          <ProductsListV6 role={role} userMarketId={role === "market_manager" ? scope.marketId : null} locale="fr" />
        </ToastProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  nav.replace.mockClear();
  nav.push.mockClear();
  nav.search = "";
  scope.marketId = "00000000-0000-0000-0000-000000000002";
  installApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProductsListV6 — the approved list", () => {
  test("asks for the market's last 30 days and lights « 30 jours », never « Aujourd’hui »", async () => {
    renderList();
    await screen.findByText("القرآن تدبر وعمل");
    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("from=2026-09-04");
    expect(url).toContain("to=2026-10-03");
    expect(screen.getByRole("button", { name: "30 jours" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Aujourd’hui" })).toHaveAttribute("aria-pressed", "false");
  });

  test("shows the five KPIs over active products, money in whole dinars", async () => {
    renderList();
    await screen.findByText("القرآن تدبر وعمل");
    const kpis = document.querySelector(".kpis") as HTMLElement;
    const text = norm(kpis.textContent);
    expect(text).toContain("Commandes reçues1 073");
    expect(text).toContain("43 %"); // 420 ÷ 976
    expect(text).toContain("53 %"); // 205 ÷ 386
    expect(text).toContain("Encaissé39 784 د.ل");
    expect(text).toContain("Payé 44 406 د.ل · Darb −4 622 د.ل");
    expect(text).toContain("+15 925 د.ل");
  });

  test("says intake stopped, and since when, when the market has been silent for more than a day", async () => {
    renderList();
    await screen.findByText("القرآن تدبر وعمل");
    expect(norm(document.querySelector(".notes")?.textContent)).toContain(
      "Aucune commande reçue depuis mar. 29 sept., 17:30. Aucune dépense pub non plus depuis ce jour.",
    );
    expect(norm(document.querySelector(".notes")?.textContent)).toContain("Aucun stock n’a encore été compté");
  });

  test("lists active products by orders received, most first, and hides the inactive", async () => {
    renderList();
    await screen.findByText("القرآن تدبر وعمل");
    const names = Array.from(document.querySelectorAll(".pname")).map((n) => n.textContent);
    expect(names).toEqual(["القرآن تدبر وعمل", "كتاب الداء والدواء", "دميه ملاكمه حجم صغير"]);
  });

  test("shows a signal chip only when it counts something", async () => {
    renderList();
    await screen.findByText("القرآن تدبر وعمل");
    const tools = within(document.querySelector(".tools") as HTMLElement);
    expect(tools.getByRole("button", { name: /1 à réapprovisionner/ })).toBeInTheDocument();
    expect(tools.getByRole("button", { name: /1 sans commande/ })).toBeInTheDocument();
    expect(tools.queryByRole("button", { name: /en perte/ })).toBeNull();
  });

  test("a product without orders says so across its row", async () => {
    renderList();
    await screen.findByText("القرآن تدبر وعمل");
    const doll = screen.getByText("دميه ملاكمه حجم صغير").closest(".tr") as HTMLElement;
    expect(within(doll).getByText("Aucune commande sur la période")).toBeInTheDocument();
  });

  test("a row opens the product sheet for the same period", async () => {
    renderList();
    fireEvent.click(await screen.findByText("كتاب الداء والدواء"));
    expect(nav.push).toHaveBeenCalledWith("/fr/products/da2?from=2026-09-04&to=2026-10-03");
  });

  test("filters through the URL", async () => {
    renderList();
    await screen.findByText("القرآن تدبر وعمل");
    fireEvent.click(screen.getByRole("button", { name: /Inactifs/ }));
    expect(nav.replace).toHaveBeenCalledWith("/fr/products?filter=inactive", { scroll: false });
  });

  test("the inactive tab shows the inactive products only", async () => {
    nav.search = "filter=inactive";
    renderList();
    await screen.findByText("XX");
    expect(screen.queryByText("القرآن تدبر وعمل")).toBeNull();
  });

  test("a super admin without a market is asked to pick one", () => {
    scope.marketId = null;
    renderList();
    expect(screen.getByText(fr.products.selectMarketPrompt)).toBeInTheDocument();
  });
});
