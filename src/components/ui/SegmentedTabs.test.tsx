import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SegmentedTabs } from "./SegmentedTabs";

const SEGMENTS = [
  { key: "all", label: "Tous", count: 75 },
  { key: "uploaded", label: "Téléchargé", count: 21 },
  { key: "deposit", label: "En cours", count: 19 },
  { key: "delivered", label: "Livré", count: 0 },
];

describe("SegmentedTabs", () => {
  it("renders one control per segment with its count", () => {
    render(
      <SegmentedTabs segments={SEGMENTS} value="all" onChange={vi.fn()} ariaLabel="Buckets" />,
    );
    for (const s of SEGMENTS) {
      expect(screen.getByText(s.label), s.label).toBeInTheDocument();
    }
    expect(screen.getByText("75")).toBeInTheDocument();
  });

  it("renders a zero count rather than hiding it", () => {
    // A hidden zero reads as "no such bucket" instead of "this bucket is empty",
    // and the row's width then shifts as counts cross zero.
    render(
      <SegmentedTabs segments={SEGMENTS} value="all" onChange={vi.fn()} ariaLabel="Buckets" />,
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("marks exactly one segment selected", () => {
    render(
      <SegmentedTabs
        segments={SEGMENTS}
        value="uploaded"
        onChange={vi.fn()}
        role="tablist"
        ariaLabel="Buckets"
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Téléchargé");
  });

  it("reports the chosen key", () => {
    const onChange = vi.fn();
    render(
      <SegmentedTabs segments={SEGMENTS} value="all" onChange={onChange} ariaLabel="Buckets" />,
    );
    fireEvent.click(screen.getByText("Livré"));
    expect(onChange).toHaveBeenCalledWith("delivered");
  });

  it("uses aria-pressed rather than tabs when it is a filter group", () => {
    // Level 2 narrows what you are already inside; it is not navigation
    // between peers, and announcing it as a tablist would say it is.
    render(
      <SegmentedTabs
        segments={SEGMENTS}
        value="all"
        onChange={vi.fn()}
        role="group"
        ariaLabel="Filtres"
      />,
    );
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("puts the accent on the active count badge only", () => {
    // §4.18: the accent moved from the underline to the badge, and exactly one
    // badge may carry it.
    const { container } = render(
      <SegmentedTabs segments={SEGMENTS} value="deposit" onChange={vi.fn()} ariaLabel="B" />,
    );
    expect(container.querySelectorAll(".bg-brand")).toHaveLength(1);
  });

  it("uses no physical direction classes, so it mirrors in RTL", () => {
    const { container } = render(
      <SegmentedTabs segments={SEGMENTS} value="all" onChange={vi.fn()} ariaLabel="B" />,
    );
    const classes = Array.from(container.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.classList))
      .join(" ");
    expect(classes).not.toMatch(/\b(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)/);
  });
});
