import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarginBar } from "./MarginBar";

describe("MarginBar", () => {
  it("renders the margin percentage label", () => {
    render(<MarginBar marginPct={32.5} />);
    expect(screen.getByText("32.5%")).toBeInTheDocument();
  });

  it("uses success color for positive margin", () => {
    render(<MarginBar marginPct={20} />);
    const fill = screen.getByTestId("margin-bar-fill");
    expect(fill.style.backgroundColor).toBe("rgb(0, 128, 96)");
  });

  it("uses critical color for negative margin", () => {
    render(<MarginBar marginPct={-12} />);
    const fill = screen.getByTestId("margin-bar-fill");
    expect(fill.style.backgroundColor).toBe("rgb(215, 44, 13)");
  });

  it("clamps fill width to 100%", () => {
    render(<MarginBar marginPct={150} />);
    const fill = screen.getByTestId("margin-bar-fill");
    expect(fill.style.width).toBe("100%");
  });

  it("uses absolute value for negative fill width", () => {
    render(<MarginBar marginPct={-30} />);
    const fill = screen.getByTestId("margin-bar-fill");
    expect(fill.style.width).toBe("30%");
  });

  it("renders dash when marginPct is null", () => {
    render(<MarginBar marginPct={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
