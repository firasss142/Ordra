import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderLockedDialog } from "../OrderLockedDialog";

const lock = {
  order_id: "o-1",
  holder_id: "a-1",
  holder_name: "Salima",
  since: new Date(Date.now() - 3 * 60_000).toISOString(),
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

const base = { open: true, lock, onClose: vi.fn(), role: "market_manager" as const };

describe("OrderLockedDialog", () => {
  it("names the agent and how long they have had it", () => {
    render(<OrderLockedDialog {...base} />);
    expect(screen.getByText(/Salima/)).toBeInTheDocument();
    expect(screen.getByText(/3 min/)).toBeInTheDocument();
  });

  // market_manager deliberately has no force-release: their recourse is to wait.
  it("offers no force-release to a market_manager", () => {
    render(<OrderLockedDialog {...base} />);
    expect(screen.queryByRole("button", { name: /forcer/i })).toBeNull();
  });

  it("offers force-release to a super_admin", () => {
    render(<OrderLockedDialog {...base} role="super_admin" onForceRelease={vi.fn()} />);
    expect(screen.getByRole("button", { name: /forcer/i })).toBeInTheDocument();
  });

  it("calls onForceRelease when a super_admin confirms", async () => {
    const onForceRelease = vi.fn();
    render(<OrderLockedDialog {...base} role="super_admin" onForceRelease={onForceRelease} />);
    await userEvent.click(screen.getByRole("button", { name: /forcer/i }));
    expect(onForceRelease).toHaveBeenCalled();
  });

  it("renders nothing when there is no lock", () => {
    const { container } = render(<OrderLockedDialog {...base} lock={null} />);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("falls back to generic copy when the holder has no name", () => {
    render(<OrderLockedDialog {...base} lock={{ ...lock, holder_name: null }} />);
    expect(
      screen.getByRole("heading", { name: /un agent travaille sur cette commande/i }),
    ).toBeInTheDocument();
  });
});
