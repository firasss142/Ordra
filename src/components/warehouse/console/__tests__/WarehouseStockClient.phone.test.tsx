import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
  product_id: id, name: `Produit ${id}`, sku: null, image_url: null, current_stock: 100,
  low_stock_threshold: 5, stock_goal: null, goal_pct: null, damaged_return_count: 0,
  engaged: 0, free: 100, last_counted_at: null, accuracy: null, series: [], sites: [],
  unallocated: 100, incoming: null, variants: [],
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
    rows: Array.from({ length: 7 }, (_, i) => row(`p${i}`)),
    warehouses: [TRIPOLI, BENGHAZI],
  };
});
afterEach(cleanup);

const renderPhone = () =>
  render(<WarehouseStockClient locale="fr" variant="agent" siteId="B" eyebrow="Benghazi · jeudi 2 octobre" />);

/**
 * Stock on the agent's phone — `R.stock` of
 * prototypes/entrepot-day-loop-agent-v3.html. The eyebrow and title, the
 * truth said first while nothing has ever been counted, then ONE card of
 * product rows. No tabs, no search, no filters, no sort.
 */
describe("WarehouseStockClient — phone", () => {
  it("names the building and the day above the title", () => {
    renderPhone();
    expect(screen.getByText("Benghazi · jeudi 2 octobre")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stock");
  });

  it("says first that nothing has been counted, and prices the count in minutes", () => {
    renderPhone();
    const truth = screen.getByTestId("wh-stock-truth");
    expect(truth).toHaveTextContent("Aucun produit n'a encore été compté");
    expect(truth).toHaveTextContent("Ces chiffres viennent du registre seul");
    // 7 products × ~25 s ≈ 3 min.
    const start = screen.getByRole("link", { name: "Commencer · 7 produits · ≈ 3 min" });
    expect(start).toHaveAttribute("href", "/fr/warehouse/count");
  });

  it("judges « never counted » at the agent's own building, not the market", () => {
    // Tripoli counted every product; Benghazi — this agent's — never did.
    body.rows = body.rows.map((r) => ({
      ...r,
      last_counted_at: "2026-10-01T09:00:00Z",
      sites: [{ warehouse_id: "T", code: "TIP", name: "Tripoli", current_stock: 40, last_counted_at: "2026-10-01T09:00:00Z" }],
    }));
    renderPhone();
    expect(screen.getByTestId("wh-stock-truth")).toBeInTheDocument();
  });

  it("drops the banner once the building has counted", () => {
    body.rows = body.rows.map((r) => ({
      ...r,
      last_counted_at: "2026-10-01T09:00:00Z",
      sites: [{ warehouse_id: "B", code: "BEN", name: "Benghazi", current_stock: 40, last_counted_at: "2026-10-01T09:00:00Z" }],
    }));
    renderPhone();
    expect(screen.queryByTestId("wh-stock-truth")).toBeNull();
  });

  it("lists every product in one card", () => {
    renderPhone();
    expect(screen.getAllByTestId("wh-stock-card")).toHaveLength(7);
  });

  it("offers no search, no filter chips, no sort and no tabs", () => {
    renderPhone();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
