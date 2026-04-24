import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopPerformingProducts } from "./TopPerformingProducts";
import type { TopProductStat } from "@/lib/dashboard/summary";

function makeProduct(overrides: Partial<TopProductStat> = {}): TopProductStat {
  return {
    product_id: "p1",
    product_name: "iPhone 14",
    delivered_count: 48,
    revenue: 24000,
    ...overrides,
  };
}

const labels = {
  title: "Produits les plus performants",
  deliveredLabel: "livrées",
  revenueLabel: "CA réalisé",
  currencySymbol: "TND",
  emptyLabel: "Aucune livraison sur la période",
};

describe("TopPerformingProducts", () => {
  it("renders empty label when products array is empty", () => {
    render(<TopPerformingProducts products={[]} showRevenue={false} {...labels} />);
    expect(screen.getByText("Aucune livraison sur la période")).toBeInTheDocument();
  });

  it("renders top 5 products in order", () => {
    const products = Array.from({ length: 5 }, (_, i) =>
      makeProduct({ product_id: `p${i}`, product_name: `Product ${i + 1}`, delivered_count: 50 - i * 5 }),
    );
    render(<TopPerformingProducts products={products} showRevenue={false} {...labels} />);
    const rows = screen.getAllByTestId("product-row");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Product 1");
    expect(rows[4]).toHaveTextContent("Product 5");
  });

  it("hides revenue column when showRevenue is false", () => {
    render(<TopPerformingProducts products={[makeProduct()]} showRevenue={false} {...labels} />);
    expect(screen.queryByText("CA réalisé")).toBeNull();
    expect(screen.queryByText(/24 000/)).toBeNull();
  });

  it("shows revenue column when showRevenue is true", () => {
    render(<TopPerformingProducts products={[makeProduct({ revenue: 24000 })]} showRevenue={true} {...labels} />);
    expect(screen.getByText("CA réalisé")).toBeInTheDocument();
  });

  it("renders delivered count for each product", () => {
    render(<TopPerformingProducts products={[makeProduct({ delivered_count: 48 })]} showRevenue={false} {...labels} />);
    expect(screen.getByText(/48/)).toBeInTheDocument();
  });

  it("renders title via Panel", () => {
    render(<TopPerformingProducts products={[]} showRevenue={false} {...labels} />);
    expect(screen.getByText("Produits les plus performants")).toBeInTheDocument();
  });
});
