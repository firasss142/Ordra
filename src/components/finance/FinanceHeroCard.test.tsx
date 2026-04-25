import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinanceHeroCard } from "./FinanceHeroCard";

describe("FinanceHeroCard", () => {
  it("renders label, value and subtitle", () => {
    render(
      <FinanceHeroCard label="Net Profit" value="2 400 TND" subtitle="18.4% margin" tone="positive" />,
    );
    expect(screen.getByText("Net Profit")).toBeInTheDocument();
    expect(screen.getByText("2 400 TND")).toBeInTheDocument();
    expect(screen.getByText("18.4% margin")).toBeInTheDocument();
  });

  it("uses success-bg tint for positive tone", () => {
    render(<FinanceHeroCard label="Net" value="100" tone="positive" />);
    const card = screen.getByTestId("hero-card");
    expect(card.style.backgroundColor).toBe("rgb(241, 248, 245)");
  });

  it("uses critical-bg tint for negative tone", () => {
    render(<FinanceHeroCard label="Net" value="-100" tone="negative" />);
    const card = screen.getByTestId("hero-card");
    expect(card.style.backgroundColor).toBe("rgb(255, 244, 244)");
  });

  it("uses white surface for neutral tone", () => {
    render(<FinanceHeroCard label="Revenue" value="10 000" tone="neutral" />);
    const card = screen.getByTestId("hero-card");
    expect(card.style.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("renders the value in critical color when tone is negative", () => {
    render(<FinanceHeroCard label="Net" value="-200" tone="negative" />);
    const value = screen.getByText("-200");
    expect(value.style.color).toBe("rgb(215, 44, 13)");
  });

  it("renders delta text when provided", () => {
    render(
      <FinanceHeroCard
        label="Revenue"
        value="10k"
        tone="neutral"
        deltaText="+8.2%"
        deltaTone="success"
      />,
    );
    expect(screen.getByText("+8.2%")).toBeInTheDocument();
  });
});
