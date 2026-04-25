import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioStrip, type PortfolioInputs } from "./PortfolioStrip";

const labels = {
  topEarner: "Top Earner",
  worstMargin: "Worst Margin",
  lowStock: "Low Stock",
  active: "Active",
  ofTotal: (n: number) => `of ${n}`,
  ofActive: (n: number) => `of ${n} active`,
  noData: "—",
};

function inputs(overrides: Partial<PortfolioInputs> = {}): PortfolioInputs {
  return {
    products: [
      { id: "a", name: "Apple", current_stock: 50, low_stock_threshold: 10, is_active: true },
      { id: "b", name: "Banana", current_stock: 5, low_stock_threshold: 10, is_active: true },
      { id: "c", name: "Cherry", current_stock: 0, low_stock_threshold: 10, is_active: false },
    ],
    metricsMap: new Map([
      ["a", { revenue: 1000, margin_pct: 25 }],
      ["b", { revenue: 500, margin_pct: -10 }],
      ["c", { revenue: 200, margin_pct: 5 }],
    ]),
    formatRevenue: (n: number) => `${n.toFixed(0)} TND`,
    ...overrides,
  };
}

describe("PortfolioStrip", () => {
  it("picks the highest-revenue product as top earner", () => {
    render(<PortfolioStrip {...inputs()} labels={labels} />);
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("picks the lowest-margin product as worst margin", () => {
    render(<PortfolioStrip {...inputs()} labels={labels} />);
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("counts low-stock active products", () => {
    render(<PortfolioStrip {...inputs()} labels={labels} />);
    expect(screen.getByText("Low Stock")).toBeInTheDocument();
    // Banana is low stock + active = 1; Cherry is inactive so excluded
    expect(screen.getByTestId("low-stock-count")).toHaveTextContent("1");
  });

  it("counts active products", () => {
    render(<PortfolioStrip {...inputs()} labels={labels} />);
    expect(screen.getByTestId("active-count")).toHaveTextContent("2");
  });

  it("shows dash when no metrics are available", () => {
    const empty: PortfolioInputs = {
      products: [{ id: "a", name: "Apple", current_stock: 50, low_stock_threshold: 10, is_active: true }],
      metricsMap: new Map(),
      formatRevenue: (n: number) => `${n} TND`,
    };
    render(<PortfolioStrip {...empty} labels={labels} />);
    // Top earner and worst margin both show dash
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
