import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogisticsKpiStrip } from "../LogisticsKpiStrip";

const tiles = [
  { label: "Étiquettes imprimées", value: "12" },
  { label: "Commandes scannées", value: "8" },
  { label: "Cycle moyen", value: "3m 20s" },
  { label: "Dans le bac", value: "4" },
];

describe("LogisticsKpiStrip", () => {
  it("renders all four tile labels", () => {
    render(<LogisticsKpiStrip tiles={tiles} />);
    for (const t of tiles) {
      expect(screen.getByText(t.label)).toBeInTheDocument();
    }
  });

  it("renders all four tile values", () => {
    render(<LogisticsKpiStrip tiles={tiles} />);
    for (const t of tiles) {
      expect(screen.getByText(t.value)).toBeInTheDocument();
    }
  });

  it("renders a clickable link when href is provided", () => {
    const tilesWithHref = [
      { label: "File d'attente", value: "7", href: "/fr/warehouse/returns" },
      ...tiles.slice(1),
    ];
    render(<LogisticsKpiStrip tiles={tilesWithHref} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/fr/warehouse/returns");
  });

  it("does not render links when href is absent", () => {
    render(<LogisticsKpiStrip tiles={tiles} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders a hint when provided", () => {
    const tilesWithHint = [
      { label: "Retours", value: "3", hint: "depuis minuit" },
      ...tiles.slice(1),
    ];
    render(<LogisticsKpiStrip tiles={tilesWithHint} />);
    expect(screen.getByText("depuis minuit")).toBeInTheDocument();
  });

  it("applies tabular-nums to value elements", () => {
    const { container } = render(<LogisticsKpiStrip tiles={tiles} />);
    // Find elements showing numeric values — they should have tabular-nums
    const valueEl = Array.from(container.querySelectorAll("[style]")).find(
      (el) => (el as HTMLElement).style.fontVariantNumeric === "tabular-nums",
    );
    expect(valueEl).toBeTruthy();
  });

  it("renders exactly four tiles for a 4-item array", () => {
    const { container } = render(<LogisticsKpiStrip tiles={tiles} />);
    // Each tile has a label + value, query by role=group or count cells
    const cells = container.querySelectorAll("[data-tile]");
    expect(cells).toHaveLength(4);
  });
});
