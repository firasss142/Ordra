import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WhSpark } from "../WhSpark";

/**
 * The sparkline that sits on every card in the mobile mockups.
 *
 * It is decoration in the accessibility tree — the figure beside it carries
 * the meaning — but it must never LIE. A flat series is a real answer, an
 * empty one is not, and the two have to look different.
 */
afterEach(cleanup);

const path = () => screen.getByTestId("wh-spark").querySelector("path[data-role='line']");

describe("WhSpark", () => {
  it("draws nothing at all when there is no history", () => {
    // An empty <svg> would read as "flat", which is a claim we cannot make.
    render(<WhSpark values={[]} />);
    expect(screen.queryByTestId("wh-spark")).toBeNull();
  });

  it("draws nothing for a single point, which has no shape", () => {
    render(<WhSpark values={[42]} />);
    expect(screen.queryByTestId("wh-spark")).toBeNull();
  });

  it("draws a flat centred line when every value is equal", () => {
    // Naively normalising (v - min) / (max - min) divides by zero here and
    // the line vanishes or jumps to an edge.
    render(<WhSpark values={[200, 200, 200, 200]} />);
    const d = path()!.getAttribute("d")!;
    const ys = [...d.matchAll(/[ ,](\d+(?:\.\d+)?)(?=[ L]|$)/g)].map((m) => Number(m[1]));
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeGreaterThan(0);
  });

  it("puts the highest value above the lowest", () => {
    // SVG y grows downward, so the biggest number must have the smallest y.
    render(<WhSpark values={[10, 90]} />);
    const nums = path()!.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const [, y0, , y1] = nums;
    expect(y1).toBeLessThan(y0);
  });

  it("draws no area under a flat line", () => {
    // The fill runs from the line to the baseline, so a flat series at
    // mid-height fills half the box and reads as a solid block, not a
    // sparkline. Nothing changed, so there is nothing to shade.
    render(<WhSpark values={[200, 200, 200]} />);
    expect(screen.getByTestId("wh-spark").querySelector("path[data-role='area']")).toBeNull();
  });

  it("draws the area under a line that actually moves", () => {
    render(<WhSpark values={[10, 40, 25]} />);
    expect(screen.getByTestId("wh-spark").querySelector("path[data-role='area']")).not.toBeNull();
  });

  it("is hidden from assistive tech — the figure beside it is the content", () => {
    render(<WhSpark values={[1, 2, 3]} />);
    expect(screen.getByTestId("wh-spark")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws one bar per point in bar mode", () => {
    render(<WhSpark values={[3, 1, 4, 1, 5]} variant="bar" />);
    expect(screen.getByTestId("wh-spark").querySelectorAll("rect")).toHaveLength(5);
  });

  it("gives a zero-height bar a visible stub rather than nothing", () => {
    // A day with no movement is a fact; an invisible bar reads as a gap.
    render(<WhSpark values={[0, 10]} variant="bar" />);
    const first = screen.getByTestId("wh-spark").querySelectorAll("rect")[0];
    expect(Number(first.getAttribute("height"))).toBeGreaterThan(0);
  });
});
