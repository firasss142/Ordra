import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlertAttentionBar } from "./AlertAttentionBar";
import type { AlertType } from "@/app/api/alerts/summary/route";

const openPanelMock = vi.fn();
vi.mock("@/context/alerts-panel", () => ({
  useAlertsPanel: () => ({
    open: false,
    openPanel: openPanelMock,
    closePanel: vi.fn(),
  }),
}));

beforeEach(() => {
  openPanelMock.mockReset();
});

const labels = {
  overdueCallbacks: "{count} rappels en retard",
  unassignedOverflow: "{count} non-assignées",
  lowStock: "{count} stocks bas",
  viewAll: "Voir tout",
  allClear: "Tout va bien",
};

function makeByType(overrides: Partial<Record<AlertType, number>> = {}): Record<AlertType, number> {
  return {
    dispatch_failure: 0,
    carrier_webhook_stale: 0,
    overdue_callback: 0,
    unassigned_overflow: 0,
    return_bottleneck: 0,
    low_stock: 0,
    stock_depleted: 0,
    agent_inactive: 0,
    ...overrides,
  };
}

describe("AlertAttentionBar", () => {
  it("renders null when market_manager and total is zero", () => {
    const { container } = render(
      <AlertAttentionBar
        byType={makeByType()}
        totalCount={0}
        role="market_manager"
        locale="fr"
        labels={labels}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when byType is null (loading)", () => {
    const { container } = render(
      <AlertAttentionBar
        byType={null}
        totalCount={0}
        role="super_admin"
        locale="fr"
        labels={labels}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders all-clear pill for super_admin when total is zero", () => {
    render(
      <AlertAttentionBar
        byType={makeByType()}
        totalCount={0}
        role="super_admin"
        locale="fr"
        labels={labels}
      />,
    );
    expect(screen.getByText("Tout va bien")).toBeInTheDocument();
  });

  it("renders chips for each non-zero category", () => {
    render(
      <AlertAttentionBar
        byType={makeByType({ overdue_callback: 3, unassigned_overflow: 12, low_stock: 2 })}
        totalCount={17}
        role="market_manager"
        locale="fr"
        labels={labels}
      />,
    );
    expect(screen.getByText(/3 rappels en retard/)).toBeInTheDocument();
    expect(screen.getByText(/12 non-assignées/)).toBeInTheDocument();
    expect(screen.getByText(/2 stocks bas/)).toBeInTheDocument();
  });

  it("omits zero-count categories when others are non-zero", () => {
    render(
      <AlertAttentionBar
        byType={makeByType({ overdue_callback: 3 })}
        totalCount={3}
        role="market_manager"
        locale="fr"
        labels={labels}
      />,
    );
    expect(screen.getByText(/3 rappels/)).toBeInTheDocument();
    expect(screen.queryByText(/non-assignées/)).toBeNull();
    expect(screen.queryByText(/stocks bas/)).toBeNull();
  });

  it("opens the alerts panel from the view-all button", () => {
    render(
      <AlertAttentionBar
        byType={makeByType({ overdue_callback: 5 })}
        totalCount={5}
        role="super_admin"
        locale="fr"
        labels={labels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Voir tout" }));
    expect(openPanelMock).toHaveBeenCalled();
  });

  it("combines low_stock and stock_depleted counts in the low stock chip", () => {
    render(
      <AlertAttentionBar
        byType={makeByType({ low_stock: 2, stock_depleted: 1 })}
        totalCount={3}
        role="market_manager"
        locale="fr"
        labels={labels}
      />,
    );
    expect(screen.getByText(/3 stocks bas/)).toBeInTheDocument();
  });
});
