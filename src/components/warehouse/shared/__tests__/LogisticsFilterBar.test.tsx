import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogisticsFilterBar } from "../LogisticsFilterBar";

describe("LogisticsFilterBar", () => {
  it("renders searchSlot content", () => {
    render(
      <LogisticsFilterBar
        searchSlot={<input placeholder="Rechercher..." />}
      />,
    );
    expect(screen.getByPlaceholderText("Rechercher...")).toBeInTheDocument();
  });

  it("renders filtersSlot content", () => {
    render(
      <LogisticsFilterBar
        filtersSlot={<select aria-label="Type"><option>Tout</option></select>}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Type" })).toBeInTheDocument();
  });

  it("renders actionsSlot content", () => {
    render(
      <LogisticsFilterBar
        actionsSlot={<button>Exporter</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Exporter" })).toBeInTheDocument();
  });

  it("renders all three slots together", () => {
    render(
      <LogisticsFilterBar
        searchSlot={<input placeholder="Rechercher..." />}
        filtersSlot={<select aria-label="Type"><option>Tout</option></select>}
        actionsSlot={<button>Exporter</button>}
      />,
    );
    expect(screen.getByPlaceholderText("Rechercher...")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exporter" })).toBeInTheDocument();
  });

  it("renders with only searchSlot (other slots optional)", () => {
    render(<LogisticsFilterBar searchSlot={<input placeholder="q" />} />);
    expect(screen.getByPlaceholderText("q")).toBeInTheDocument();
  });

  it("uses a white card container without boxShadow", () => {
    const { container } = render(<LogisticsFilterBar />);
    const root = container.firstElementChild as HTMLElement;
    const computed = window.getComputedStyle(root);
    // White background
    expect(computed.backgroundColor).toBe("rgb(255, 255, 255)");
    // No box-shadow decoration
    const inlineStyle = root.getAttribute("style") ?? "";
    expect(inlineStyle).not.toMatch(/box-shadow/i);
  });
});
