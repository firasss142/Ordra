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
    expect(screen.getByTestId("bar-fill-cogs").style.width).toBe("20%");
    expect(screen.getByTestId("bar-fill-delivery").style.width).toBe("10%");
    expect(screen.getByTestId("bar-fill-returns").style.width).toBe("5%");
  });

  /**
   * Tone is asserted through a data attribute rather than a computed hex.
   * The fills are token-backed now, so `style.backgroundColor` reads
   * "var(--fin-green)" and a hex assertion would test nothing.
   */
  it("keeps an ordinary cost row on the default green fill", () => {
    render(
      <CostCompositionBars data={baseData} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    expect(screen.getByTestId("bar-fill-cogs").dataset.tone).toBe("default");
    expect(screen.getByTestId("bar-fill-cogs").className).toContain("bg-fin-green");
  });

  it("escalates the returns row to gold between 10% and 15% of revenue", () => {
    const data = { ...baseData, return_cost: 120 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    const bar = screen.getByTestId("bar-fill-returns");
    expect(bar.dataset.tone).toBe("warn");
    expect(bar.className).toContain("bg-fin-gold");
  });

  it("escalates the returns row to red above 15% of revenue", () => {
    const data = { ...baseData, return_cost: 200 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    const bar = screen.getByTestId("bar-fill-returns");
    expect(bar.dataset.tone).toBe("bad");
    expect(bar.className).toContain("bg-oms-age-late");
  });

  it("renders the net profit row in critical ink when negative", () => {
    const data = { ...baseData, net_profit: -100 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    const netRow = screen.getByTestId("net-profit-row");
    expect(netRow.className).toContain("text-oms-age-late");
  });

  it("renders the net profit row in navy ink when positive", () => {
    render(
      <CostCompositionBars data={baseData} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    expect(screen.getByTestId("net-profit-row").className).toContain("text-fin-navy");
  });

  it("handles zero revenue gracefully", () => {
    const data = { ...baseData, revenue: 0 };
    render(
      <CostCompositionBars data={data} formatCurrency={(n) => `${n}`} labels={labels} />,
    );
    expect(screen.getByTestId("bar-fill-cogs").style.width).toBe("0%");
  });
});
