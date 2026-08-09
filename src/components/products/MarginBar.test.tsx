import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarginBar } from "./MarginBar";

describe("MarginBar", () => {
  it("renders the margin percentage label", () => {
    render(<MarginBar marginPct={32.5} />);
    expect(screen.getByText("32.5%")).toBeInTheDocument();
  });

  it("accepts a locale-aware formatter — toFixed alone is wrong in Arabic", () => {
    render(
      <MarginBar
        marginPct={32.5}
        format={(p) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1 }).format(p) + "%"}
      />,
    );
    // fr-FR uses a comma as the decimal separator.
    expect(screen.getByText("32,5%")).toBeInTheDocument();
  });

  // Three tiers, because `thinMargin` is a real facet on this page: a thin but
  // positive margin is a different state from a loss and from a healthy margin.
  // Asserting the tone rather than a hex means a palette change does not break
  // the test, but losing a tier does.
  it("marks a healthy margin as positive", () => {
    render(<MarginBar marginPct={20} />);
    expect(screen.getByTestId("margin-bar-fill")).toHaveAttribute("data-tone", "positive");
  });

  it("marks a positive margin at or below the thin ceiling as thin", () => {
    render(<MarginBar marginPct={10} />);
    expect(screen.getByTestId("margin-bar-fill")).toHaveAttribute("data-tone", "thin");
  });

  it("marks a negative margin as negative", () => {
    render(<MarginBar marginPct={-12} />);
    expect(screen.getByTestId("margin-bar-fill")).toHaveAttribute("data-tone", "negative");
  });

  it("a margin just above the ceiling is positive, not thin", () => {
    render(<MarginBar marginPct={10.1} />);
    expect(screen.getByTestId("margin-bar-fill")).toHaveAttribute("data-tone", "positive");
  });

  // The bar is scaled x2 so the 0–50 % band, where every real product sits, uses
  // the full width instead of the leftmost sliver. The exact figure sits beside
  // it, so the bar only has to be monotonic — which it is.
  it("scales the fill x2 and clamps at 100%", () => {
    render(<MarginBar marginPct={30} />);
    expect(screen.getByTestId("margin-bar-fill").style.width).toBe("60%");
  });

  it("clamps fill width to 100%", () => {
    render(<MarginBar marginPct={150} />);
    expect(screen.getByTestId("margin-bar-fill").style.width).toBe("100%");
  });

  it("uses absolute value for negative fill width", () => {
    render(<MarginBar marginPct={-30} />);
    expect(screen.getByTestId("margin-bar-fill").style.width).toBe("60%");
  });

  it("floors a tiny margin to a visible sliver", () => {
    render(<MarginBar marginPct={0.5} />);
    expect(screen.getByTestId("margin-bar-fill").style.width).toBe("8%");
  });

  it("renders dash when marginPct is null", () => {
    render(<MarginBar marginPct={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByTestId("margin-bar-fill")).not.toBeInTheDocument();
  });
});
