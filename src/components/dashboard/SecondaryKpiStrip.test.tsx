import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SecondaryKpiStrip } from "./SecondaryKpiStrip";
import type { DashboardKpis } from "@/lib/dashboard/summary";

function makeKpis(overrides: Partial<DashboardKpis> = {}): DashboardKpis {
  return {
    revenue: null,
    netProfit: null,
    confirmationRate: { current: 87, previous: 85, delta: 2, deltaPct: 2.4 },
    rejectionRate: { current: 13, previous: 15, delta: -2, deltaPct: -13.3 },
    ordersProcessed: { current: 342, previous: 300, delta: 42, deltaPct: 14 },
    deliveryRate: { current: 78, previous: 74, delta: 4, deltaPct: 5.4 },
    agentsOnline: 5,
    agentsTotal: 8,
    agentsIdle: 1,
    ...overrides,
  };
}

const labels = {
  ordersProcessed: "Commandes traitées",
  rejectionRate: "Taux de rejet",
  agentsOnline: "Agents actifs",
  openOrders: "Commandes ouvertes",
  idleSuffix: "inactifs",
  offlineSuffix: "hors ligne",
};

describe("SecondaryKpiStrip", () => {
  describe("super_admin", () => {
    it("renders orders processed card", () => {
      render(
        <SecondaryKpiStrip
          role="super_admin"
          kpis={makeKpis()}
          openOrdersCount={150}
          agentsIdle={1}
          agentsOffline={2}
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Commandes traitées")).toBeInTheDocument();
      expect(screen.getByText("342")).toBeInTheDocument();
    });

    it("renders rejection rate card", () => {
      render(
        <SecondaryKpiStrip
          role="super_admin"
          kpis={makeKpis()}
          openOrdersCount={150}
          agentsIdle={1}
          agentsOffline={2}
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Taux de rejet")).toBeInTheDocument();
    });

    it("renders agents online card", () => {
      render(
        <SecondaryKpiStrip
          role="super_admin"
          kpis={makeKpis()}
          openOrdersCount={150}
          agentsIdle={1}
          agentsOffline={2}
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Agents actifs")).toBeInTheDocument();
      expect(screen.getByText("5/8")).toBeInTheDocument();
    });
  });

  describe("market_manager", () => {
    it("renders agents online card", () => {
      render(
        <SecondaryKpiStrip
          role="market_manager"
          kpis={makeKpis()}
          openOrdersCount={150}
          agentsIdle={1}
          agentsOffline={2}
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Agents actifs")).toBeInTheDocument();
    });

    it("renders open orders card with correct count", () => {
      render(
        <SecondaryKpiStrip
          role="market_manager"
          kpis={makeKpis()}
          openOrdersCount={150}
          agentsIdle={1}
          agentsOffline={2}
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.getByText("Commandes ouvertes")).toBeInTheDocument();
      expect(screen.getByText("150")).toBeInTheDocument();
    });

    it("does not render rejection rate or orders processed cards", () => {
      render(
        <SecondaryKpiStrip
          role="market_manager"
          kpis={makeKpis()}
          openOrdersCount={150}
          agentsIdle={1}
          agentsOffline={2}
          periodLabel="vs hier"
          labels={labels}
        />,
      );
      expect(screen.queryByText("Commandes traitées")).toBeNull();
      expect(screen.queryByText("Taux de rejet")).toBeNull();
    });
  });
});
