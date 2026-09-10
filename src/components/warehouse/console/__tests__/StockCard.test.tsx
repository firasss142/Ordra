import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { StockCard } from "../StockCard";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";

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

/**
 * One product on the phone: a row that answers "how many do I have" at a
 * glance and opens for the rest. Reserved, threshold, last count, the last
 * movements and the count action live inside, because the shelf question
 * comes first and the others are rare.
 */
const row = (over: Partial<WarehouseStockRow> = {}): WarehouseStockRow => ({
  product_id: "11111111-1111-4111-8111-111111111111",
  name: "دمية الملاكمة حجم كبير",
  sku: "BOX-01",
  image_url: null,
  current_stock: 150,
  low_stock_threshold: 20,
  stock_goal: null,
  goal_pct: null,
  damaged_return_count: 0,
  engaged: 10,
  free: 140,
  last_counted_at: null,
  accuracy: null,
  series: [],
  sites: [],
  unallocated: 0,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      rows: [
        { kind: "scan", id: "h1", at: new Date().toISOString(), qty_change: -1, balance_after: 150, detail: "Scan sortie", product_name: "x" },
        { kind: "return", id: "h2", at: new Date(Date.now() - 86_400_000).toISOString(), qty_change: 1, balance_after: 151, detail: "Retour", product_name: "x" },
      ],
      nextCursor: null,
    }),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("StockCard", () => {
  it("answers the shelf question first: name, on shelf, free", () => {
    render(<StockCard row={row()} onCount={() => {}} />);
    expect(screen.getByText("دمية الملاكمة حجم كبير")).toBeInTheDocument();
    expect(screen.getByTestId("wh-stock-shelf")).toHaveTextContent("150");
    expect(screen.getByTestId("wh-stock-free")).toHaveTextContent("140");
  });

  it("flags low stock and a deficit in words", () => {
    render(<StockCard row={row({ current_stock: 12, free: 2 })} onCount={() => {}} />);
    expect(screen.getByTestId("wh-stock-card")).toHaveAttribute("data-state", "low");
    expect(screen.getByText("Sous le seuil")).toBeInTheDocument();
    cleanup();
    render(<StockCard row={row({ current_stock: 5, engaged: 9, free: -4 })} onCount={() => {}} />);
    expect(screen.getByTestId("wh-stock-card")).toHaveAttribute("data-state", "negative");
    expect(screen.getByTestId("wh-stock-free")).toHaveTextContent("-4");
  });

  it("keeps reserved, threshold, last count and the count action behind a tap", async () => {
    const onCount = vi.fn();
    render(<StockCard row={row()} onCount={onCount} />);
    expect(screen.queryByRole("button", { name: "Compter" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /دمية الملاكمة/ }));
    const more = await screen.findByTestId("wh-stock-more");
    expect(more).toHaveTextContent("10");
    expect(more).toHaveTextContent("Seuil d'alerte : 20");
    expect(more).toHaveTextContent("jamais compté");
    fireEvent.click(within(more).getByRole("button", { name: "Compter" }));
    expect(onCount).toHaveBeenCalled();
  });

  it("loads the last movements when opened, and only then", async () => {
    render(<StockCard row={row()} onCount={() => {}} />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /دمية الملاكمة/ }));
    const list = await screen.findByTestId("wh-stock-movements");
    await waitFor(() => expect(list).toHaveTextContent("−1"));
    expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain(
      "product_id=11111111-1111-4111-8111-111111111111",
    );
  });

  it("names a target only when someone set one", () => {
    render(<StockCard row={row({ stock_goal: 200, goal_pct: 75 })} onCount={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /دمية الملاكمة/ }));
    expect(screen.getByText(/Objectif : 200/)).toBeInTheDocument();
  });
});

/**
 * Where the units actually sit.
 *
 * Libya runs two buildings, `product_site_stock` has ventilated the market
 * total between them since September, and no screen ever showed it — so an
 * agent in Benghazi read Tripoli's shelf as part of their own.
 */
describe("StockCard — the buildings", () => {
  const sites = [
    { warehouse_id: "w-tri", code: "tripoli", name: "Tripoli", current_stock: 12, last_counted_at: "2026-09-01T00:00:00Z" },
    { warehouse_id: "w-ben", code: "benghazi", name: "Benghazi", current_stock: 5, last_counted_at: null },
  ];

  it("names each building and what it holds", () => {
    render(<StockCard row={row({ current_stock: 20, sites, unallocated: 3 })} onCount={() => {}} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const lines = within(screen.getByTestId("wh-stock-sites")).getAllByRole("listitem");
    expect(lines[0]).toHaveTextContent("Tripoli");
    expect(lines[0]).toHaveTextContent("12");
    expect(lines[1]).toHaveTextContent("Benghazi");
    expect(lines[1]).toHaveTextContent("5");
  });

  it("says which building has never been counted, rather than implying zero", () => {
    render(<StockCard row={row({ current_stock: 20, sites, unallocated: 3 })} onCount={() => {}} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const lines = within(screen.getByTestId("wh-stock-sites")).getAllByRole("listitem");
    expect(lines[1]).toHaveTextContent(/jamais compté/);
    expect(lines[0]).not.toHaveTextContent(/jamais compté/);
  });

  it("names the units no building accounts for", () => {
    // The invariant is an inequality — sum(sites) <= market total — so the gap
    // is a real quantity. Hiding it would make the two figures contradict.
    render(<StockCard row={row({ current_stock: 20, sites, unallocated: 3 })} onCount={() => {}} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByTestId("wh-stock-unallocated")).toHaveTextContent("3");
  });

  it("says nothing about buildings in a market that has only one", () => {
    render(<StockCard row={row({ sites: [], unallocated: 0 })} onCount={() => {}} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByTestId("wh-stock-sites")).not.toBeInTheDocument();
  });

  it("draws the fortnight only when there is a line to draw", () => {
    render(<StockCard row={row({ series: [10, 12, 9, 14] })} onCount={() => {}} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByTestId("wh-stock-spark")).toBeInTheDocument();
    cleanup();

    // One point is not a trend, and an empty box reads as a broken chart.
    render(<StockCard row={row({ series: [] })} onCount={() => {}} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByTestId("wh-stock-spark")).not.toBeInTheDocument();
  });
});
