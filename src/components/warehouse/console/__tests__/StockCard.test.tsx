import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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
 * One product, as the phone shows it (mockup 03-inventory).
 *
 * The card makes four claims — held, target, history, accuracy — and every one
 * of them has to be absent rather than faked when the warehouse has not done
 * the work that produces it.
 */
const row = (over: Partial<WarehouseStockRow> = {}): WarehouseStockRow => ({
  product_id: "p-1",
  name: "دمية الملاكمة حجم كبير",
  sku: "BOX-01",
  image_url: null,
  current_stock: 150,
  low_stock_threshold: 20,
  stock_goal: 200,
  goal_pct: 75,
  damaged_return_count: 0,
  engaged: 10,
  free: 140,
  last_counted_at: null,
  accuracy: null,
  series: [140, 145, 150],
  ...over,
});

afterEach(cleanup);

describe("StockCard", () => {
  it("shows what a picker matches against the shelf: name and code", () => {
    render(<StockCard row={row()} onCount={() => {}} />);
    expect(screen.getByText("دمية الملاكمة حجم كبير")).toBeInTheDocument();
    expect(screen.getByText("BOX-01")).toBeInTheDocument();
  });

  it("shows progress toward a target when one is set", () => {
    render(<StockCard row={row()} onCount={() => {}} />);
    const bar = screen.getByTestId("wh-stock-goal-bar");
    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByTestId("wh-stock-goal").textContent).toContain("200");
  });

  it("shows the alarm threshold instead when no target is set", () => {
    // "Goal: 0" would paint every untargeted product as wildly overstocked.
    render(<StockCard row={row({ stock_goal: null, goal_pct: null })} onCount={() => {}} />);
    expect(screen.queryByTestId("wh-stock-goal-bar")).toBeNull();
    expect(screen.getByTestId("wh-stock-threshold").textContent).toContain("20");
  });

  it("marks a product at or under its threshold", () => {
    render(<StockCard row={row({ current_stock: 15, low_stock_threshold: 20 })} onCount={() => {}} />);
    expect(screen.getByTestId("wh-stock-card").dataset.state).toBe("low");
  });

  it("marks a product that owes more than it holds", () => {
    // Being oversold is a worse fact than being low, and must outrank it.
    render(<StockCard row={row({ current_stock: 5, low_stock_threshold: 20, free: -3 })} onCount={() => {}} />);
    expect(screen.getByTestId("wh-stock-card").dataset.state).toBe("negative");
  });

  it("says never counted rather than showing an accuracy of 100 %", () => {
    render(<StockCard row={row({ accuracy: null, last_counted_at: null })} onCount={() => {}} />);
    expect(screen.queryByTestId("wh-stock-accuracy")).toBeNull();
    expect(screen.getByText(/jamais compté/i)).toBeInTheDocument();
  });

  it("shows the accuracy of the last count when there was one", () => {
    render(
      <StockCard
        row={row({ accuracy: 98, last_counted_at: new Date(Date.now() - 86_400_000).toISOString() })}
        onCount={() => {}}
      />,
    );
    expect(screen.getByTestId("wh-stock-accuracy").textContent).toContain("98");
  });

  it("omits the sparkline when there is no history to draw", () => {
    render(<StockCard row={row({ series: [] })} onCount={() => {}} />);
    expect(screen.queryByTestId("wh-spark")).toBeNull();
  });

  it("offers counting as a real, reachable action", () => {
    const onCount = vi.fn();
    render(<StockCard row={row()} onCount={onCount} />);
    const btn = screen.getByRole("button", { name: /compter/i });
    expect(btn.className).toMatch(/min-h-\[44px\]/);
    btn.click();
    expect(onCount).toHaveBeenCalledWith(expect.objectContaining({ product_id: "p-1" }));
  });

  it("falls back to a glyph when the product has no photo", () => {
    render(<StockCard row={row({ image_url: null })} onCount={() => {}} />);
    expect(within(screen.getByTestId("wh-stock-thumb")).queryByRole("img")).toBeNull();
  });
});
