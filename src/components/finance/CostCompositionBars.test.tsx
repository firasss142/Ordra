import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostCompositionBars } from "./CostCompositionBars";

const labels = {
  cogs: "COGS",
  delivery: "Delivery",
  returns: "Returns",
  packing: "Packing",
  ads: "Ads",
  netProfit: "Net Profit",
  ofRevenue: "% of revenue",
};

const baseData = {
  revenue: 1000,
  cogs: 200,
  delivery_cost: 100,
  return_cost: 50,
  packing_cost: 30,
  ad_spend: 150,
  net_profit: 470,
};

describe("CostCompositionBars", () => {
  it("renders all cost rows with correct % of revenue", () => {
    render(
      <CostCompositionBars
        data={baseData}
        formatCurrency={(n) => `${n} TND`}
        labels={labels}
      />,
    );
    // 200/1000 = 20%
    expect(screen.getByTestId("bar-fill-cogs").style.width).toBe("20%");
    // 100/1000 = 10%
    expect(screen.getByTestId("bar-fill-delivery").style.width).toBe("10%");
    // 50/1000 = 5%
    expect(screen.getByTestId("bar-fill-returns").style.width).toBe("5%");
  });

  it("turns returns row amber when between 10% and 15% of revenue", () => {
    const data = { ...baseData, return_cost: 120 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    expect(screen.getByTestId("bar-fill-returns").style.backgroundColor).toBe(
      "rgb(185, 137, 0)",
    );
  });

  it("turns returns row red when above 15% of revenue", () => {
    const data = { ...baseData, return_cost: 200 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    expect(screen.getByTestId("bar-fill-returns").style.backgroundColor).toBe(
      "rgb(215, 44, 13)",
    );
  });

  it("renders the net profit row in critical color when negative", () => {
    const data = { ...baseData, net_profit: -100 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    const netRow = screen.getByTestId("net-profit-row");
    expect(netRow.style.color).toBe("rgb(215, 44, 13)");
  });

  it("handles zero revenue gracefully", () => {
    const data = { ...baseData, revenue: 0 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    // Should not crash, all bars at 0
    expect(screen.getByTestId("bar-fill-cogs").style.width).toBe("0%");
  });
});
