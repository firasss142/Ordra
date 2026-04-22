import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders label and value", () => {
    render(<KpiCard label="Revenue" value="12 400 TND" />);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("12 400 TND")).toBeInTheDocument();
  });

  it("renders positive delta text in success color", () => {
    render(<KpiCard label="Revenue" value="12 400" deltaText="+8.2%" deltaTone="success" />);
    const delta = screen.getByText("+8.2%");
    expect(delta).toBeInTheDocument();
    expect(delta.style.color).toBe("rgb(0, 128, 96)");
  });

  it("renders negative delta in critical color", () => {
    render(<KpiCard label="Rejection rate" value="11.4%" deltaText="-0.6 pp" deltaTone="critical" />);
    expect(screen.getByText("-0.6 pp").style.color).toBe("rgb(215, 44, 13)");
  });

  it("falls back to subtitle when deltaText missing", () => {
    render(<KpiCard label="Agents en ligne" value="7" subtitle="2 inactifs · 1 hors ligne" />);
    expect(screen.getByText("2 inactifs · 1 hors ligne")).toBeInTheDocument();
  });
});
