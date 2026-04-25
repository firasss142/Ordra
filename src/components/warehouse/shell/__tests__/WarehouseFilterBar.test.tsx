import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WarehouseFilterBar, type FilterChip } from "../WarehouseFilterBar";

describe("WarehouseFilterBar", () => {
  it("renders the search input with placeholder", () => {
    render(
      <WarehouseFilterBar
        search={{ value: "", onChange: () => {}, placeholder: "Rechercher…" }}
        chips={[]}
      />,
    );
    expect(screen.getByPlaceholderText("Rechercher…")).toBeInTheDocument();
  });

  it("calls search onChange as user types", () => {
    const onChange = vi.fn();
    render(
      <WarehouseFilterBar
        search={{ value: "", onChange, placeholder: "Rechercher…" }}
        chips={[]}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Rechercher…"), {
      target: { value: "abc" },
    });
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("renders all filter chips with their labels", () => {
    const chips: FilterChip[] = [
      { id: "kind", label: "Type: scan", onRemove: () => {} },
      { id: "actor", label: "Agent: Karim", onRemove: () => {} },
    ];
    render(<WarehouseFilterBar chips={chips} />);
    expect(screen.getByText("Type: scan")).toBeInTheDocument();
    expect(screen.getByText("Agent: Karim")).toBeInTheDocument();
  });

  it("calls onRemove when a chip's remove button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <WarehouseFilterBar
        chips={[{ id: "kind", label: "Type: scan", onRemove }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove type: scan/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders the actions slot", () => {
    render(
      <WarehouseFilterBar chips={[]} actions={<button>Exporter</button>} />,
    );
    expect(screen.getByRole("button", { name: "Exporter" })).toBeInTheDocument();
  });

  it("renders without search when not provided", () => {
    render(<WarehouseFilterBar chips={[]} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("uses no hardcoded hex colors", () => {
    const { container } = render(
      <WarehouseFilterBar
        search={{ value: "", onChange: () => {}, placeholder: "q" }}
        chips={[{ id: "x", label: "x", onRemove: () => {} }]}
      />,
    );
    expect(container.innerHTML).not.toMatch(/#FFFFFF|#E1E3E5|#1A1A1A/);
  });
});
