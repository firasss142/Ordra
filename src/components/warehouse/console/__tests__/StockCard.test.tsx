import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { StockCard } from "../StockCard";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
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
