import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsBand } from "./InsightsBand";
import type { Insight } from "@/lib/dashboard/insights";

describe("InsightsBand", () => {
  it("renders null when insights array is empty", () => {
    const { container } = render(<InsightsBand insights={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per insight", () => {
    const insights: Insight[] = [
      { key: "a", text: "Insight A", tone: "positive" },
      { key: "b", text: "Insight B", tone: "negative" },
      { key: "c", text: "Insight C", tone: "neutral" },
    ];
    render(<InsightsBand insights={insights} />);
    expect(screen.getByText("Insight A")).toBeInTheDocument();
    expect(screen.getByText("Insight B")).toBeInTheDocument();
    expect(screen.getByText("Insight C")).toBeInTheDocument();
  });

  it("applies green color for positive tone", () => {
    const insights: Insight[] = [{ key: "a", text: "Good news", tone: "positive" }];
    render(<InsightsBand insights={insights} />);
    const el = screen.getByText("Good news");
    expect(el.closest("[data-tone]")).toHaveAttribute("data-tone", "positive");
  });

  it("applies red color for negative tone", () => {
    const insights: Insight[] = [{ key: "a", text: "Bad news", tone: "negative" }];
    render(<InsightsBand insights={insights} />);
    const el = screen.getByText("Bad news");
    expect(el.closest("[data-tone]")).toHaveAttribute("data-tone", "negative");
  });
});
