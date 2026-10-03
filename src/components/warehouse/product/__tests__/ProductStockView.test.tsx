import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";
import { ProductStockView } from "../ProductStockView";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * One product's page — where « Mouvements » finally lands.
 *
 * The free figure, the split by building told honestly (a building that never
 * counted says so rather than showing 0), the stock no building has counted
 * yet, the product's own movements, and the way to count it.
 */

const coran: WarehouseStockRow = {
  product_id: "qr", name: "Coran « Tadabbur wa ʿAmal »", sku: "qr-01", image_url: null,
  current_stock: 943, low_stock_threshold: 99, stock_goal: null, goal_pct: null, damaged_return_count: 0,
  engaged: 29, free: 914, last_counted_at: null, accuracy: null, series: [],
  sites: [{ warehouse_id: "B", code: "benghazi", name: "Benghazi", current_stock: 900, last_counted_at: "2026-10-02T09:00:00Z" }],
  unallocated: 43, incoming: null,
};

let stock: WarehouseStockRow[] = [coran];
let sites: WarehouseSitesResponse;
let history: WarehouseHistoryRow[] = [];
vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key.startsWith("/api/warehouse/sites")
      ? sites
      : key.startsWith("/api/warehouse/history")
        ? { rows: history, nextCursor: null }
        : { rows: stock },
    error: undefined,
    isLoading: false,
  }),
}));

const TRIPOLI = { id: "T", code: "tripoli", name: "Tripoli", isDefault: true, marketId: "m-ly" };
const BENGHAZI = { id: "B", code: "benghazi", name: "Benghazi", isDefault: false, marketId: "m-ly" };

function renderView(productId = "qr") {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
      <ProductStockView productId={productId} locale="fr" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  stock = [coran];
  sites = { sites: [TRIPOLI, BENGHAZI], mine: null, pinned: false, unassigned: false };
  history = [
    {
      kind: "scan", id: "h1", order_id: "o1", order_number: "1042", product_id: "qr", product_name: "Coran",
      qty_change: -1, balance_after: 943, at: "2026-09-29T12:42:00Z", detail: "Sortie scannée",
      is_damaged: false, is_reprint: false, note: null,
      actor: { id: "a", full_name: "adel", role: "warehouse_agent", avatar_url: null }, anomalies: [],
    },
  ];
});
afterEach(cleanup);

describe("ProductStockView", () => {
  it("leads with what can be promised: the free figure", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Coran « Tadabbur wa ʿAmal »");
    expect(screen.getByTestId("product-free")).toHaveTextContent("914");
  });

  it("splits the stock by building, and says which building never counted", () => {
    renderView();
    const split = screen.getByRole("region", { name: "Par bâtiment" });
    const tripoli = within(split).getByText("Tripoli").closest("li")!;
    expect(tripoli).toHaveTextContent("jamais compté");
    const benghazi = within(split).getByText("Benghazi").closest("li")!;
    expect(benghazi).toHaveTextContent("900");
    expect(within(split).getByText("Non ventilé").closest("li")!).toHaveTextContent("43");
  });

  it("lists the product's own movements and links to its whole journal", () => {
    renderView();
    expect(screen.getByText("Sortie scannée")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tout le journal de ce produit/ })).toHaveAttribute(
      "href",
      "/fr/warehouse/stock?tab=journal&product=qr",
    );
  });

  it("lets a manager count it at the building they choose", () => {
    renderView();
    fireEvent.change(screen.getByLabelText("Compter à"), { target: { value: "T" } });
    expect(screen.getByRole("link", { name: "Compter" })).toHaveAttribute(
      "href",
      "/fr/warehouse/count?product=qr&warehouse_id=T",
    );
  });

  it("sends an agent to count their own building, with no choice to make", () => {
    sites = { sites: [TRIPOLI, BENGHAZI], mine: "B", pinned: true, unassigned: false };
    renderView();
    expect(screen.queryByLabelText("Compter à")).toBeNull();
    expect(screen.getByRole("link", { name: "Compter" })).toHaveAttribute("href", "/fr/warehouse/count?product=qr");
  });

  it("says when the product is not in this market", () => {
    renderView("elsewhere");
    expect(screen.getByText("Produit introuvable dans ce marché.")).toBeInTheDocument();
  });
});
