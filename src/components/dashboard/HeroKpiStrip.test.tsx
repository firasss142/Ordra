import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroKpiStrip } from "./HeroKpiStrip";
import type { DashboardKpis, TrendPoint } from "@/lib/dashboard/summary";

function makeTrend(n = 10): TrendPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    day: `2026-04-${String(i + 1).padStart(2, "0")}`,
    confRate: 87,
    rejRate: 13,
    revenue: 1000,
  }));
}

function makeKpis(overrides: Partial<DashboardKpis> = {}): DashboardKpis {
  return {
    revenue: { current: 12450, previous: 11500, delta: 950, deltaPct: 8.2 },
    netProfit: { current: 8200, previous: 7800, delta: 400, deltaPct: 5.1 },
    confirmationRate: { current: 87.3, previous: 85.1, delta: 2.2, deltaPct: 2.6 },
    rejectionRate: { current: 12.7, previous: 14.9, delta: -2.2, deltaPct: -14.8 },
    ordersProcessed: { current: 342, previous: 298, delta: 44, deltaPct: 14.8 },
    deliveryRate: { current: 78.2, previous: 76.5, delta: 1.7, deltaPct: 2.2 },
    agentsOnline: 5,
    agentsTotal: 8,
    agentsIdle: 1,
    ...overrides,
  };
}

const labels = {
  revenue: "Chiffre d'affaires",
  netProfit: "Profit net",
  confirmationRate: "Taux de confirmation",
  rejectionRate: "Taux de rejet",
  ordersProcessed: "Commandes traitées",
  deliveryRate: "Taux de livraison",
};

describe("HeroKpiStrip", () => {
  describe("super_admin", () => {
    it("renders Revenue, Net Profit, Confirmation Rate, Delivery Rate cards", () => {
      render(
        <HeroKpiStrip
          role="super_admin"
          kpis={makeKpis()}
          trend={makeTrend()}
          currencySymbol="TND"
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Chiffre d'affaires")).toBeInTheDocument();
      expect(screen.getByText("Profit net")).toBeInTheDocument();
      expect(screen.getByText("Taux de confirmation")).toBeInTheDocument();
      expect(screen.getByText("Taux de livraison")).toBeInTheDocument();
    });

    it("does not render Orders Processed or Rejection Rate in hero", () => {
      render(
        <HeroKpiStrip
          role="super_admin"
          kpis={makeKpis()}
          trend={makeTrend()}
          currencySymbol="TND"
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.queryByText("Commandes traitées")).toBeNull();
      expect(screen.queryByText("Taux de rejet")).toBeNull();
    });

    it("falls back to manager quad when revenue is null", () => {
      render(
        <HeroKpiStrip
          role="super_admin"
          kpis={makeKpis({ revenue: null, netProfit: null })}
          trend={makeTrend()}
          currencySymbol="TND"
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Taux de confirmation")).toBeInTheDocument();
      expect(screen.getByText("Commandes traitées")).toBeInTheDocument();
      expect(screen.getByText("Taux de rejet")).toBeInTheDocument();
      expect(screen.getByText("Taux de livraison")).toBeInTheDocument();
    });
  });

  describe("market_manager", () => {
    it("renders Confirmation Rate, Orders Processed, Rejection Rate, Delivery Rate", () => {
      render(
        <HeroKpiStrip
          role="market_manager"
          kpis={makeKpis({ revenue: null, netProfit: null })}
          trend={makeTrend()}
          currencySymbol="TND"
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Taux de confirmation")).toBeInTheDocument();
      expect(screen.getByText("Commandes traitées")).toBeInTheDocument();
      expect(screen.getByText("Taux de rejet")).toBeInTheDocument();
      expect(screen.getByText("Taux de livraison")).toBeInTheDocument();
    });

    it("does not render Revenue or Net Profit", () => {
      render(
        <HeroKpiStrip
          role="market_manager"
          kpis={makeKpis({ revenue: null, netProfit: null })}
          trend={makeTrend()}
          currencySymbol="TND"
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.queryByText("Chiffre d'affaires")).toBeNull();
      expect(screen.queryByText("Profit net")).toBeNull();
    });
  });

  it("renders periodLabel in delta text", () => {
    render(
      <HeroKpiStrip
        role="super_admin"
        kpis={makeKpis()}
        trend={makeTrend()}
        currencySymbol="TND"
        periodLabel="vs hier"
        labels={labels}
      />,
    );
    const deltaTexts = screen.getAllByText(/vs hier/);
    expect(deltaTexts.length).toBeGreaterThan(0);
  });

  it("renders delivery rate with inverted tone styling (positive when rate increases)", () => {
    render(
      <HeroKpiStrip
        role="super_admin"
        kpis={makeKpis({ deliveryRate: { current: 80, previous: 75, delta: 5, deltaPct: 6.7 } })}
        trend={makeTrend()}
        currencySymbol="TND"
        periodLabel="vs hier"
        labels={labels}
      />,
    );
    // Delta is positive (5%), tone should be success (green) since higher delivery rate is good
    const deltaEl = screen.getByTestId("delivery-rate-delta");
    expect(deltaEl).toHaveStyle({ color: "rgb(0, 128, 96)" });
  });
});
