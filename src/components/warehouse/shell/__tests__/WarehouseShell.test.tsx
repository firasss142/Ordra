import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarehouseShell } from "../WarehouseShell";

describe("WarehouseShell", () => {
  it("renders the page title", () => {
    render(
      <WarehouseShell title="Préparation">
        <div>workspace</div>
      </WarehouseShell>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Préparation" }),
    ).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(
      <WarehouseShell title="Retours" subtitle="Triage des retours">
        <div>workspace</div>
      </WarehouseShell>,
    );
    expect(screen.getByText("Triage des retours")).toBeInTheDocument();
  });

  it("renders children inside a workspace region", () => {
    render(
      <WarehouseShell title="Test">
        <div data-testid="ws">content</div>
      </WarehouseShell>,
    );
    expect(screen.getByTestId("ws")).toBeInTheDocument();
  });

  it("renders the actions slot in the header band", () => {
    render(
      <WarehouseShell title="Test" actions={<button>Imprimer</button>}>
        <div />
      </WarehouseShell>,
    );
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeInTheDocument();
  });

  it("renders the kpi slot when provided", () => {
    render(
      <WarehouseShell
        title="Test"
        kpiStrip={<div data-testid="kpi">kpis</div>}
      >
        <div />
      </WarehouseShell>,
    );
    expect(screen.getByTestId("kpi")).toBeInTheDocument();
  });

  it("renders the filter bar slot when provided", () => {
    render(
      <WarehouseShell
        title="Test"
        filterBar={<div data-testid="filters">filters</div>}
      >
        <div />
      </WarehouseShell>,
    );
    expect(screen.getByTestId("filters")).toBeInTheDocument();
  });

  it("uses semantic token classes for the page background", () => {
    const { container } = render(
      <WarehouseShell title="Test">
        <div />
      </WarehouseShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/bg-surface-page/);
  });

  it("does not include hardcoded hex colors in className", () => {
    const { container } = render(
      <WarehouseShell title="Test">
        <div />
      </WarehouseShell>,
    );
    const html = (container.firstElementChild as HTMLElement).outerHTML;
    expect(html).not.toMatch(/#F6F6F7|#FFFFFF|#E1E3E5|#1A1A1A/);
  });
});
