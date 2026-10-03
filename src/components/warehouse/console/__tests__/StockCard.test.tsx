import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * One product on the phone — prototypes/entrepot-day-loop-agent-v3.html,
 * `R.stock` › `.prod`. A single row that answers « combien puis-je promettre » :
 * the thumb, the name, « Registre 943 · Engagé 29 · sous le seuil », fourteen
 * days of line, and the FREE figure in bold. The rest lives on the product's
 * page, which the whole row opens.
 */
const row = (over: Partial<WarehouseStockRow> = {}): WarehouseStockRow => ({
  product_id: "11111111-1111-4111-8111-111111111111",
  name: "مصحف القرآن تدبر وعمل",
  sku: "qr-01",
  image_url: null,
  current_stock: 943,
  low_stock_threshold: 99,
  stock_goal: null,
  goal_pct: null,
  damaged_return_count: 0,
  engaged: 29,
  free: 914,
  last_counted_at: null,
  accuracy: null,
  series: [950, 949, 948, 947, 946, 945, 944, 943, 943, 943, 943, 943, 943, 943],
  sites: [],
  unallocated: 0,
  incoming: null,
  variants: [],
  ...over,
});

afterEach(cleanup);

describe("StockCard — the phone's product row", () => {
  it("opens the product's page from the whole row", () => {
    render(<StockCard row={row()} locale="fr" />);
    expect(screen.getByTestId("wh-stock-card")).toHaveAttribute(
      "href",
      "/fr/warehouse/stock/11111111-1111-4111-8111-111111111111",
    );
  });

  it("leads with the free figure, labelled « Libre »", () => {
    render(<StockCard row={row()} locale="fr" />);
    expect(screen.getByTestId("wh-stock-free")).toHaveTextContent("914");
    expect(screen.getByTestId("wh-stock-card")).toHaveTextContent("Libre");
  });

  it("reads the register and what is engaged on one line", () => {
    render(<StockCard row={row()} locale="fr" />);
    expect(screen.getByTestId("wh-stock-meta")).toHaveTextContent("Registre 943 · Engagé 29");
  });

  it("says nothing about engaged units when none are", () => {
    render(<StockCard row={row({ engaged: 0, free: 943 })} locale="fr" />);
    expect(screen.getByTestId("wh-stock-meta")).toHaveTextContent("Registre 943");
    expect(screen.getByTestId("wh-stock-meta")).not.toHaveTextContent("Engagé");
  });

  it("flags a product whose free stock is at or under its threshold", () => {
    // The prototype's rule: free (register − engaged) ≤ threshold.
    render(<StockCard row={row({ current_stock: 120, engaged: 25, free: 95 })} locale="fr" />);
    expect(screen.getByTestId("wh-stock-meta")).toHaveTextContent("sous le seuil");
    cleanup();
    render(<StockCard row={row()} locale="fr" />);
    expect(screen.getByTestId("wh-stock-meta")).not.toHaveTextContent("sous le seuil");
  });

  it("draws fourteen days of the balance, 56 px wide", () => {
    render(<StockCard row={row()} locale="fr" />);
    expect(screen.getByTestId("stock-spark")).toHaveAttribute("width", "56");
  });

  it("carries nothing the prototype row does not: no expander, no count button", () => {
    render(<StockCard row={row()} locale="fr" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("wh-stock-card")).not.toHaveTextContent("qr-01");
  });
});
