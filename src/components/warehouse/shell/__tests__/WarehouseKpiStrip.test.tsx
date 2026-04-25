import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WarehouseKpiStrip } from "../WarehouseKpiStrip";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const tiles = [
  { label: "Étiquettes imprimées", value: "12" },
  { label: "Commandes scannées", value: "8" },
  { label: "Cycle moyen", value: "3m 20s" },
  { label: "Dans le bac", value: "4" },
];

describe("WarehouseKpiStrip", () => {
  it("renders all four tile labels and values", () => {
    render(<WarehouseKpiStrip tiles={tiles} />);
    for (const t of tiles) {
      expect(screen.getByText(t.label)).toBeInTheDocument();
      expect(screen.getByText(t.value)).toBeInTheDocument();
    }
  });

  it("renders a clickable link tile when href is provided", () => {
    render(
      <WarehouseKpiStrip
        tiles={[{ label: "File", value: "7", href: "/fr/warehouse/returns" }, ...tiles.slice(1)]}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/fr/warehouse/returns");
  });

  it("calls onClick when an actionable tile is clicked", () => {
    const onClick = vi.fn();
    render(
      <WarehouseKpiStrip
        tiles={[{ label: "Anomalies", value: "2", onClick }, ...tiles.slice(1)]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /anomalies/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a hint when provided", () => {
    render(
      <WarehouseKpiStrip
        tiles={[{ label: "Retours", value: "3", hint: "depuis minuit" }, ...tiles.slice(1)]}
      />,
    );
    expect(screen.getByText("depuis minuit")).toBeInTheDocument();
  });

  it("uses semantic Tailwind tokens, not raw hex", () => {
    const { container } = render(<WarehouseKpiStrip tiles={tiles} />);
    expect(container.innerHTML).not.toMatch(/#FFFFFF|#E1E3E5|#F6F6F7|#1A1A1A/);
  });

  it("applies tabular-nums to value elements via class", () => {
    const { container } = render(<WarehouseKpiStrip tiles={tiles} />);
    const tabularEls = container.querySelectorAll(".tabular-nums");
    expect(tabularEls.length).toBeGreaterThan(0);
  });
});
