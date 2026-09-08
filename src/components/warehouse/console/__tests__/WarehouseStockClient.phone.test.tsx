import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WarehouseStockClient } from "../WarehouseStockClient";
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
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const row = (id: string, name: string, stock: number, free: number): WarehouseStockRow => ({
  product_id: id, name, sku: null, image_url: null, current_stock: stock, low_stock_threshold: 20,
  stock_goal: null, goal_pct: null, damaged_return_count: 0, engaged: stock - free, free,
  last_counted_at: null, accuracy: null, series: [],
});

vi.mock("swr", () => ({
  default: () => ({
    data: { rows: [row("a", "القرآن تدبر وعمل", 1000, 924), row("b", "دمية صغيرة", 12, -2)] },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));
afterEach(cleanup);

/**
 * The stock list on the phone. The two chips answer the whole catalogue until
 * a search narrows it, then they answer the search: a chip that ignores the
 * filter under it reads as a bug.
 */
describe("WarehouseStockClient — phone", () => {
  it("chips count low and negative products, and follow the search", () => {
    render(<WarehouseStockClient locale="fr" />);
    expect(screen.getByTestId("wh-stock-chip-low")).toHaveTextContent("1");
    expect(screen.getByTestId("wh-stock-chip-negative")).toHaveTextContent("1");
    fireEvent.change(screen.getByLabelText(/Rechercher/), { target: { value: "القرآن" } });
    expect(screen.getByTestId("wh-stock-chip-low")).toHaveTextContent("0");
    expect(screen.getByTestId("wh-stock-chip-negative")).toHaveTextContent("0");
  });

  it("says no product matches, not that there are no products", () => {
    render(<WarehouseStockClient locale="fr" />);
    fireEvent.change(screen.getByLabelText(/Rechercher/), { target: { value: "zzz" } });
    expect(screen.getByText("Aucun produit ne correspond.")).toBeInTheDocument();
  });

  it("says once, above the list, that nothing was ever counted", () => {
    render(<WarehouseStockClient locale="fr" />);
    expect(screen.getByTestId("wh-stock-never-counted")).toBeInTheDocument();
  });
});
