import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import type { WarehouseStockRow, WarehouseStockResponse } from "@/app/api/warehouse/stock/route";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";
import { ProductStockView } from "../ProductStockView";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * One product's page — `R.product` (phone) and `C.product` (desk) of the v3
 * prototypes. The free figure first, the stacked bar, the split by building
 * told honestly, the product's own movements named by their EVENT, and the way
 * to count it.
 */

const coran: WarehouseStockRow = {
  product_id: "qr", name: "Coran « Tadabbur wa ʿAmal »", sku: "qr-01", image_url: null,
  current_stock: 943, low_stock_threshold: 99, stock_goal: null, goal_pct: null, damaged_return_count: 0,
  engaged: 29, free: 914, last_counted_at: null, accuracy: null, series: [],
  sites: [], unallocated: 943, incoming: null, variants: [],
};

const TRIPOLI = { id: "T", code: "TIP", name: "Tripoli", isDefault: true };
const BENGHAZI = { id: "B", code: "BEN", name: "Benghazi", isDefault: false };

let stock: WarehouseStockResponse;
let sites: WarehouseSitesResponse;
let history: WarehouseHistoryRow[] = [];
const keys: string[] = [];
vi.mock("swr", () => ({
  default: (key: string) => {
    keys.push(key);
    return {
      data: key.startsWith("/api/warehouse/sites")
        ? sites
        : key.startsWith("/api/warehouse/history")
          ? { rows: history, nextCursor: null }
          : stock,
      error: undefined,
      isLoading: false,
    };
  },
}));

const move = (id: string, over: Partial<WarehouseHistoryRow> = {}): WarehouseHistoryRow => ({
  kind: "scan", id, order_id: "o1", order_number: "1042", product_id: "qr", product_name: "Coran",
  qty_change: -1, balance_after: 943, at: "2026-09-29T12:42:00Z", detail: "1042 · Coran · Souad",
  is_damaged: false, is_reprint: false, note: null, reason: "scanned", warehouse_name: "Benghazi",
  actor: { id: "a", full_name: "adel", role: "warehouse_agent", avatar_url: null }, anomalies: [],
  ...over,
});

function renderView(variant: "agent" | "desk", productId = "qr", siteId: string | null = null) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
      <ProductStockView productId={productId} locale="fr" variant={variant} siteId={siteId} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  keys.length = 0;
  stock = { rows: [coran], warehouses: [{ id: "T", code: "TIP", name: "Tripoli" }, { id: "B", code: "BEN", name: "Benghazi" }] };
  sites = { sites: [TRIPOLI, BENGHAZI], mine: null, pinned: false, unassigned: false };
  history = Array.from({ length: 6 }, (_, i) => move(`h${i}`, { balance_after: 943 + i }));
});
afterEach(cleanup);

describe("ProductStockView — phone", () => {
  beforeEach(() => {
    sites = { sites: [TRIPOLI, BENGHAZI], mine: "B", pinned: true, unassigned: false };
  });

  it("titles the page with the product, its sku as the eyebrow, and a way back", () => {
    renderView("agent");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Coran « Tadabbur wa ʿAmal »");
    expect(screen.getByText("qr-01")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stock" })).toHaveAttribute("href", "/fr/warehouse/stock");
  });

  it("leads with the free figure, and says the product was never counted", () => {
    renderView("agent");
    const card = screen.getByTestId("product-free-card");
    expect(within(card).getByTestId("product-free")).toHaveTextContent("914");
    expect(card).toHaveTextContent("jamais compté");
    // The legend names engaged, free, and « En route » — a dash when nothing is announced.
    expect(card).toHaveTextContent(/Engagé\s*29/);
    expect(card).toHaveTextContent(/Libre\s*914/);
    expect(card).toHaveTextContent(/En route\s*—/);
    expect(screen.queryByTestId("stack-incoming")).toBeNull();
  });

  it("hatches what a reception announces", () => {
    stock.rows = [{ ...coran, incoming: 40 }];
    renderView("agent");
    expect(screen.getByTestId("stack-incoming")).toBeInTheDocument();
    expect(screen.getByTestId("product-free-card")).toHaveTextContent(/En route\s*40/);
  });

  it("says in one line that no building has counted it", () => {
    renderView("agent");
    expect(screen.getByText("Compté dans aucun bâtiment — le chiffre est celui du marché.")).toBeInTheDocument();
  });

  it("splits it by building once one has counted", () => {
    stock.rows = [{
      ...coran,
      sites: [{ warehouse_id: "B", code: "BEN", name: "Benghazi", current_stock: 900, last_counted_at: "2026-10-02T09:00:00Z" }],
      unallocated: 43,
    }];
    renderView("agent");
    const split = screen.getByTestId("product-sites");
    expect(within(split).getByText("Tripoli").closest("[data-site]")!).toHaveTextContent("—");
    expect(within(split).getByText("Benghazi").closest("[data-site]")!).toHaveTextContent("900");
    expect(within(split).getByText("Non ventilé").closest("[data-site]")!).toHaveTextContent("43");
    expect(screen.queryByTestId("product-free-card")!).not.toHaveTextContent("jamais compté");
  });

  it("lists five movements by their event, not by order or customer", () => {
    renderView("agent");
    const list = screen.getByTestId("product-moves");
    const items = within(list).getAllByTestId("product-move");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("Sortie scannée");
    expect(items[0]).toHaveTextContent(/29 sept\. · \d\d:42/);
    expect(items[0]).toHaveTextContent("−1");
    expect(items[0]).toHaveTextContent("943");
    expect(list).not.toHaveTextContent("Souad");
    expect(list).not.toHaveTextContent("1042");
  });

  it("opens all the product's movements, then counts it", () => {
    renderView("agent");
    expect(screen.getByRole("link", { name: "Tous les mouvements" })).toHaveAttribute(
      "href",
      "/fr/warehouse/stock?tab=journal&product=qr",
    );
    expect(screen.getByRole("link", { name: "Compter ce produit" })).toHaveAttribute(
      "href",
      "/fr/warehouse/count?product=qr",
    );
  });

  it("says when the product is not in this market", () => {
    renderView("agent", "elsewhere");
    expect(screen.getByText("Produit introuvable dans ce marché.")).toBeInTheDocument();
  });
});

describe("ProductStockView — desk", () => {
  it("heads the page with the sku and the name, then « Compter à » a building", () => {
    renderView("desk");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Coran « Tadabbur wa ʿAmal »");
    expect(screen.getByText("qr-01")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Compter à"), { target: { value: "B" } });
    expect(screen.getByRole("link", { name: "Compter" })).toHaveAttribute(
      "href",
      "/fr/warehouse/count?product=qr&warehouse_id=B",
    );
  });

  it("pre-selects the building the top bar chose", () => {
    renderView("desk", "qr", "B");
    expect(screen.getByLabelText("Compter à")).toHaveValue("B");
  });

  it("leads with the free card: figure, chip, and a legend of engaged, free and register", () => {
    renderView("desk");
    const card = screen.getByTestId("product-free-card");
    expect(within(card).getByTestId("product-free")).toHaveTextContent("914");
    expect(card).toHaveTextContent("jamais");
    expect(card).toHaveTextContent(/Engagé\s*29/);
    expect(card).toHaveTextContent(/Libre\s*914/);
    expect(card).toHaveTextContent(/Registre\s*943/);
  });

  it("splits it by building in a table, every building named, the unallocated last", () => {
    renderView("desk");
    const split = screen.getByRole("region", { name: "Par bâtiment" });
    const rows = within(split).getAllByRole("row").map((r) => r.textContent);
    expect(rows).toEqual(["Tripoli—Jamais compté", "Benghazi—Jamais compté", "Non ventilé943"]);
  });

  it("says when the product comes in no variant", () => {
    renderView("desk");
    expect(screen.getByTestId("product-variants")).toHaveTextContent("Variantes · Ce produit ne se décline pas.");
  });

  it("lists the variants and their stock when it does", () => {
    stock.rows = [{ ...coran, variants: [{ id: "v1", label: "Grand", current_stock: 12 }] }];
    renderView("desk");
    const v = screen.getByTestId("product-variants");
    expect(v).toHaveTextContent("Grand");
    expect(v).toHaveTextContent("12");
  });

  it("lists six movements with who and where, and links to the product's whole journal", () => {
    renderView("desk");
    const items = within(screen.getByTestId("product-moves")).getAllByTestId("product-move");
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent(/Sortie scannée29 sept\. · \d\d:42 · adel · Benghazi−1943/);
    expect(screen.getByRole("link", { name: /Tout le journal de ce produit/ })).toHaveAttribute(
      "href",
      "/fr/warehouse/stock?tab=journal&product=qr",
    );
  });

  it("asks the ledger for the product only", () => {
    renderView("desk");
    expect(keys.find((k) => k.startsWith("/api/warehouse/history"))).toContain("product_id=qr");
  });
});
