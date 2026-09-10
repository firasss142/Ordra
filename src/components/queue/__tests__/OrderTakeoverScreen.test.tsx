import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderTakeoverScreen } from "../OrderTakeoverScreen";

describe("OrderTakeoverScreen", () => {
  it("names who took the order", () => {
    render(<OrderTakeoverScreen releasedByName="Firas" onDismiss={vi.fn()} />);
    expect(screen.getByText(/Firas/)).toBeInTheDocument();
  });

  it("falls back to generic copy when the admin is unnamed", () => {
    render(<OrderTakeoverScreen releasedByName={null} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  // It interrupts a phone call, so it must be an alert, not a toast.
  it("announces itself assertively to assistive tech", () => {
    render(<OrderTakeoverScreen releasedByName="Firas" onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("returns the agent to the queue on the single CTA", async () => {
    const onDismiss = vi.fn();
    render(<OrderTakeoverScreen releasedByName="Firas" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onDismiss).toHaveBeenCalled();
  });
});
