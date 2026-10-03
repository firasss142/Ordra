import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { WarehouseStockClient } from "../WarehouseStockClient";
import type { WarehouseStockRow, WarehouseStockResponse } from "@/app/api/warehouse/stock/route";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const row = (id: string, over: Partial<WarehouseStockRow> = {}): WarehouseStockRow => ({
  product_id: id, name: `Produit ${id}`, sku: `sku-${id}`, image_url: null, current_stock: 943,
  low_stock_threshold: 99, stock_goal: null, goal_pct: null, damaged_return_count: 0,
  engaged: 29, free: 914, last_counted_at: null, accuracy: null,
  series: [950, 949, 948, 947, 946, 945, 944, 943, 943, 943, 943, 943, 943, 943],
  sites: [], unallocated: 943, incoming: null, variants: [],
  ...over,
});

const TRIPOLI = { id: "T", code: "TIP", name: "Tripoli" };
const BENGHAZI = { id: "B", code: "BEN", name: "Benghazi" };

let body: WarehouseStockResponse;
vi.mock("swr", () => ({
  default: () => ({ data: body, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

beforeEach(() => {
  body = {
    rows: [row("qr"), row("th", { engaged: 0, free: 216, current_stock: 216, unallocated: 216 })],
    warehouses: [TRIPOLI, BENGHAZI],
  };
});
afterEach(cleanup);

const renderDesk = (siteId: string | null = null) =>
  render(<WarehouseStockClient locale="fr" variant="desk" siteId={siteId} />);

function headers() {
  return screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
}

/**
 * Stock › Niveaux on the desk — `C.stock` of
 * prototypes/entrepot-day-loop-manager-v3.html: one line of truth with the
 * way to fix it, then ONE table. No search, no filter chips, no KPI tiles.
 */
describe("WarehouseStockClient — desk", () => {
  it("says on one line that nothing has been counted, with the way to start", () => {
    renderDesk();
    const truth = screen.getByTestId("wh-stock-truth");
    expect(truth).toHaveTextContent("Aucun produit n'a encore été compté.");
    expect(truth).toHaveTextContent("Les colonnes par bâtiment restent vides");
    expect(within(truth).getByRole("link", { name: /Lancer le comptage/ })).toHaveAttribute(
      "href",
      "/fr/warehouse/count",
    );
  });

  it("starts the count at the building the top bar has chosen", () => {
    renderDesk("B");
    expect(within(screen.getByTestId("wh-stock-truth")).getByRole("link")).toHaveAttribute(
      "href",
      "/fr/warehouse/count?warehouse_id=B",
    );
  });

  it("has one column per building, between the free figure and the unallocated stock", () => {
    renderDesk();
    expect(headers()).toEqual([
      "Produit", "Registre", "Engagé", "Libre", "Tripoli", "Benghazi", "Non ventilé",
      "Dernier comptage", "14 jours", "",
    ]);
  });

  it("drops the building columns in a market with one building", () => {
    body.warehouses = [];
    body.rows = body.rows.map((r) => ({ ...r, unallocated: 0 }));
    renderDesk();
    expect(headers()).toEqual(["Produit", "Registre", "Engagé", "Libre", "Dernier comptage", "14 jours", ""]);
  });

  it("reads a product as the prototype row does", () => {
    renderDesk();
    const qr = screen.getByTestId("wh-stock-row-qr");
    const cells = within(qr).getAllByRole("cell").map((c) => c.textContent ?? "");
    expect(cells[0]).toContain("Produit qr");
    expect(cells[0]).toContain("sku-qr");
    expect(cells.slice(1, 7)).toEqual(["943", "29", "914", "—", "—", "943"]);
    expect(cells[7]).toBe("jamais");
  });

  it("draws a dash, not a zero, for nothing engaged", () => {
    renderDesk();
    const th = screen.getByTestId("wh-stock-row-th");
    expect(within(th).getAllByRole("cell")[2]).toHaveTextContent("—");
  });

  it("shows a building's figure once that building holds a ventilated share", () => {
    body.rows = [row("qr", {
      last_counted_at: "2026-10-01T09:00:00Z",
      sites: [{ warehouse_id: "B", code: "BEN", name: "Benghazi", current_stock: 900, last_counted_at: "2026-10-01T09:00:00Z" }],
      unallocated: 43,
    })];
    renderDesk();
    const cells = within(screen.getByTestId("wh-stock-row-qr")).getAllByRole("cell").map((c) => c.textContent ?? "");
    expect(cells.slice(4, 7)).toEqual(["—", "900", "43"]);
    expect(cells[7]).toBe("1 oct.");
  });

  it("dates the last count at the building in view", () => {
    body.rows = [row("qr", {
      last_counted_at: "2026-10-01T09:00:00Z",
      sites: [{ warehouse_id: "T", code: "TIP", name: "Tripoli", current_stock: 900, last_counted_at: "2026-10-01T09:00:00Z" }],
    })];
    renderDesk("B");
    const cells = within(screen.getByTestId("wh-stock-row-qr")).getAllByRole("cell").map((c) => c.textContent ?? "");
    expect(cells[7]).toBe("jamais");
  });

  it("draws the fourteen-day line 64 px wide", () => {
    renderDesk();
    expect(within(screen.getByTestId("wh-stock-row-qr")).getByTestId("stock-spark")).toHaveAttribute("width", "64");
  });

  it("ends each row with Mouvements (filtered journal) and Compter", () => {
    renderDesk("B");
    const qr = screen.getByTestId("wh-stock-row-qr");
    expect(within(qr).getByRole("link", { name: "Mouvements" })).toHaveAttribute(
      "href",
      "/fr/warehouse/stock?tab=journal&product=qr&warehouse_id=B",
    );
    expect(within(qr).getByRole("link", { name: "Compter" })).toHaveAttribute(
      "href",
      "/fr/warehouse/count?product=qr&warehouse_id=B",
    );
    expect(within(qr).getByRole("link", { name: /Produit qr/ })).toHaveAttribute("href", "/fr/warehouse/stock/qr");
  });

  it("offers no search, no filter chips and no KPI tiles", () => {
    renderDesk();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId(/^wh-kpi-/)).toBeNull();
  });
});
