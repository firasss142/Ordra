import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Badge } from "./Badge";

function rootOf(text: string): HTMLElement {
  // The outer wrapper is the parent of the text-bearing inner span.
  const inner = screen.getByText(text);
  return inner.parentElement as HTMLElement;
}

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Confirmed</Badge>);
    expect(screen.getByText("Confirmed")).toBeDefined();
  });

  it("applies neutral tone by default", () => {
    render(<Badge>Neutral</Badge>);
    expect(rootOf("Neutral").className).toMatch(/bg-status-neutralBg/);
  });

  it("applies success tone classes", () => {
    render(<Badge tone="success">OK</Badge>);
    const el = rootOf("OK");
    expect(el.className).toMatch(/bg-status-successBg/);
    expect(el.className).toMatch(/text-status-success/);
  });

  it("applies warning tone classes", () => {
    render(<Badge tone="warning">Wait</Badge>);
    expect(rootOf("Wait").className).toMatch(/bg-status-warningBg/);
  });

  it("applies critical tone classes", () => {
    render(<Badge tone="critical">No</Badge>);
    expect(rootOf("No").className).toMatch(/bg-status-criticalBg/);
  });

  it("applies action tone classes", () => {
    render(<Badge tone="action">Go</Badge>);
    expect(rootOf("Go").className).toMatch(/text-status-action/);
  });

  it("renders dot when dot prop is true", () => {
    const { container } = render(<Badge tone="success" dot>OK</Badge>);
    expect(container.querySelector("[data-badge-dot]")).not.toBeNull();
  });

  it("does not render dot when dot prop is absent", () => {
    const { container } = render(<Badge tone="success">OK</Badge>);
    expect(container.querySelector("[data-badge-dot]")).toBeNull();
  });

  it("forwards extra className", () => {
    render(<Badge className="extra">X</Badge>);
    expect(rootOf("X").className).toMatch(/extra/);
  });
});
