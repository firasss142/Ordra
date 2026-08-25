import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WhKpiGrid } from "../primitives";

/**
 * The KPI row.
 *
 * On a desk it is an auto-fitting grid. On a 390px phone that grid collapses
 * to one card per row, and four KPIs then push the actual work — the queue —
 * two screens down. The mockups answer this with a snap-scrolling strip whose
 * fourth card is deliberately half-visible, so the row reads as scrollable.
 */
afterEach(cleanup);

describe("WhKpiGrid", () => {
  it("scrolls horizontally on a phone and snaps", () => {
    const { container } = render(<WhKpiGrid><div>a</div></WhKpiGrid>);
    const el = container.firstElementChild!;
    expect(el.className).toMatch(/overflow-x-auto/);
    expect(el.className).toMatch(/snap-x/);
  });

  it("becomes a grid again at desk width", () => {
    const { container } = render(<WhKpiGrid><div>a</div></WhKpiGrid>);
    expect(container.firstElementChild!.className).toMatch(/md:grid/);
    expect(container.firstElementChild!.className).toMatch(/md:overflow-visible/);
  });

  it("gives each card a width so the next one peeks into view", () => {
    // A strip whose cards fill the viewport gives no hint that it scrolls.
    const { container } = render(<WhKpiGrid><div>a</div></WhKpiGrid>);
    expect(container.firstElementChild!.className).toMatch(/min-w-\[/);
  });

  it("still renders every card it is given", () => {
    render(
      <WhKpiGrid>
        <div>one</div>
        <div>two</div>
      </WhKpiGrid>,
    );
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });
});
