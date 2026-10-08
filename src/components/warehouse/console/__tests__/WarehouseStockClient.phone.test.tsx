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
    incoming: null,
});

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const swr = vi.hoisted(() => ({ loading: false }));
vi.mock("swr", () => ({
  default: () =>
    swr.loading
      ? { data: undefined, error: undefined, isLoading: true, mutate: vi.fn() }
      : {
          data: { rows: [row("a", "القرآن تدبر وعمل", 1000, 924), row("b", "دمية صغيرة", 12, -2)] },
          error: undefined,
          isLoading: false,
          mutate: vi.fn(),
        },
}));
afterEach(() => {
  cleanup();
  swr.loading = false;
});

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

  it("turns that statement into the way out: the count run", () => {
    // 0 stock_count rows in prod on 2026-10-02. Saying it is not enough; the
    // screen offers the gesture that fixes it.
    render(<WarehouseStockClient locale="fr" />);
    const banner = screen.getByTestId("wh-stock-never-counted");
    expect(banner).toHaveTextContent("Aucun produit n'a encore été compté.");
    expect(screen.getByRole("link", { name: /Commencer le comptage/ })).toHaveAttribute("href", "/fr/warehouse/count");
  });
});

describe("WarehouseStockClient — links", () => {
  it("counts through the count run, the one way to count", () => {
    // The old dialog compared a building's count with the MARKET total — a
    // false gap in Libya, where two buildings share one total.
    render(<WarehouseStockClient locale="fr" />);
    const [first] = screen.getAllByRole("link", { name: "Compter" });
    expect(first).toHaveAttribute("href", "/fr/warehouse/count?product=a");
  });

  it("opens the count run from a phone card too", () => {
    render(<WarehouseStockClient locale="fr" />);
    fireEvent.click(screen.getAllByTestId("wh-stock-card")[0].querySelector("button")!);
    fireEvent.click(screen.getAllByRole("button", { name: "Compter" })[0]);
    expect(push).toHaveBeenCalledWith("/fr/warehouse/count?product=a");
  });

  it("opens a product's own page from its name", () => {
    render(<WarehouseStockClient locale="fr" />);
    const links = screen.getAllByRole("link", { name: "القرآن تدبر وعمل" });
    expect(links[0]).toHaveAttribute("href", "/fr/warehouse/stock/a");
  });

  it("sends « Mouvements » to the Journal filtered on the product, not to a redirect", () => {
    // It pointed at /warehouse/history?product_id=…, which redirected to Stock,
    // dropped the product and landed on the levels tab.
    render(<WarehouseStockClient locale="fr" />);
    const [first] = screen.getAllByRole("link", { name: /Mouvements/ });
    expect(first).toHaveAttribute("href", "/fr/warehouse/stock?tab=journal&product=a");
  });

  // The chips read « 0 · 0 · 0 · 0 » and the card « 0 » for a moment, then 87.
  it("shows no count while the stock is on its way", () => {
    swr.loading = true;
    render(<WarehouseStockClient locale="fr" />);
    for (const s of screen.getAllByTestId("wh-stock-seg")) expect(s).not.toHaveTextContent(/\d/);
    expect(screen.getByRole("heading", { level: 2, name: "Stock" }).parentElement).not.toHaveTextContent(/\d/);
  });
});
