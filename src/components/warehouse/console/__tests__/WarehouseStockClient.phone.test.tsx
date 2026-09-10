import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WarehouseStockClient } from "../WarehouseStockClient";
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
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const row = (id: string, name: string, stock: number, free: number): WarehouseStockRow => ({
  product_id: id, name, sku: null, image_url: null, current_stock: stock, low_stock_threshold: 20,
  stock_goal: null, goal_pct: null, damaged_return_count: 0, engaged: stock - free, free,
  last_counted_at: null, accuracy: null, series: [], sites: [], unallocated: 0,
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
 * The stock list on the phone. The segments count the whole catalogue until a
 * search narrows it, then they answer the search: a count that ignores the
 * filter under it reads as a bug. They are also the filter itself now — the
 * screen used to show these figures and give no way to act on them.
 */
function seg(key: string) {
  return screen.getAllByTestId("wh-stock-seg").find((s) => s.dataset.key === key)!;
}

describe("WarehouseStockClient — phone", () => {
  it("segments count the states of the shelf, and follow the search", () => {
    render(<WarehouseStockClient locale="fr" />);
    expect(seg("all")).toHaveTextContent("2");
    // "دمية صغيرة" holds 12 against a threshold of 20 AND owes more than it
    // holds. Owing outranks being low, so it is counted once, as negative.
    expect(seg("negative")).toHaveTextContent("1");
    expect(seg("low")).toHaveTextContent("0");
    fireEvent.change(screen.getByLabelText(/Rechercher/), { target: { value: "القرآن" } });
    expect(seg("negative")).toHaveTextContent("0");
  });

  it("narrows the list to a single state when a segment is tapped", () => {
    render(<WarehouseStockClient locale="fr" />);
    expect(screen.getAllByTestId("wh-stock-card")).toHaveLength(2);
    fireEvent.click(seg("negative"));
    const after = screen.getAllByTestId("wh-stock-card");
    expect(after).toHaveLength(1);
    expect(after[0]).toHaveTextContent("دمية صغيرة");
  });

  it("says no product matches, not that there are no products", () => {
    render(<WarehouseStockClient locale="fr" />);
    fireEvent.change(screen.getByLabelText(/Rechercher/), { target: { value: "zzz" } });
    expect(screen.getByText("Aucun produit pour ces filtres.")).toBeInTheDocument();
  });

  it("says once, above the list, that nothing was ever counted", () => {
    render(<WarehouseStockClient locale="fr" />);
    expect(screen.getByTestId("wh-stock-never-counted")).toBeInTheDocument();
  });
});
