import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogisticsPageHeader } from "../LogisticsPageHeader";

describe("LogisticsPageHeader", () => {
  it("renders the title", () => {
    render(<LogisticsPageHeader title="Préparation" />);
    expect(screen.getByRole("heading", { level: 1, name: "Préparation" })).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(<LogisticsPageHeader title="Retours" subtitle="Scannez les retours" />);
    expect(screen.getByText("Scannez les retours")).toBeInTheDocument();
  });

  it("does not render subtitle element when omitted", () => {
    render(<LogisticsPageHeader title="Historique" />);
    expect(screen.queryByText(/./)).toHaveTextContent("Historique");
  });

  it("renders actions slot content", () => {
    render(
      <LogisticsPageHeader title="Vue d'ensemble" actions={<button>Export</button>} />,
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("places actions alongside the title in the same flex row", () => {
    const { container } = render(
      <LogisticsPageHeader title="Test" actions={<span data-testid="action" />} />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    const action = container.querySelector("[data-testid='action']");
    // The flex row container is the parent of the title wrapper and the actions wrapper
    const titleParent = heading.closest("div")?.parentElement;
    const actionParent = action!.closest("div")?.parentElement;
    expect(titleParent).toBe(actionParent);
  });

  it("uses dir-agnostic flex layout (no hardcoded left/right margin)", () => {
    const { container } = render(<LogisticsPageHeader title="RTL test" />);
    const root = container.firstElementChild as HTMLElement;
    const style = root.getAttribute("style") ?? "";
    // Must not have hardcoded left/right padding that would break RTL
    expect(style).not.toMatch(/padding-left|padding-right|margin-left|margin-right/);
  });
});
