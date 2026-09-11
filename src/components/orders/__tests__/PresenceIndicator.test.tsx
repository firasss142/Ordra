import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceIndicator } from "../PresenceIndicator";

const NOW = new Date("2026-09-10T10:05:00.000Z");
const agent = {
  order_id: "o-1",
  user_id: "a-1",
  role: "agent" as const,
  mode: "editing" as const,
  opened_at: "2026-09-10T10:00:00.000Z",
  expires_at: "2026-09-10T10:06:00.000Z",
};
const manager = { ...agent, user_id: "m-1", role: "market_manager" as const, mode: "viewing" as const };

const person = (id: string) =>
  id === "a-1"
    ? { full_name: "Salima", avatar_url: "https://x/s.jpg" }
    : id === "m-1"
      ? { full_name: "Imen", avatar_url: null }
      : null;

const base = { assigneeName: "Salima", assigneeAvatarUrl: "https://x/s.jpg", personOf: person, now: NOW };

describe("PresenceIndicator — the assignee avatar IS the indicator", () => {
  it("renders the assignee avatar even when nobody is present", () => {
    render(<PresenceIndicator {...base} rows={[]} />);
    expect(screen.getByTestId("assignee-avatar")).toBeInTheDocument();
  });

  // One face, not two: no extra head is appended beside the name.
  it("adds no second avatar when the assignee is the one present", () => {
    render(<PresenceIndicator {...base} rows={[agent]} />);
    expect(screen.queryAllByTestId("extra-presence")).toHaveLength(0);
  });

  it("rings the assignee avatar when they have the order open", () => {
    render(<PresenceIndicator {...base} rows={[agent]} />);
    expect(screen.getByTestId("assignee-avatar").getAttribute("data-presence")).toBe("agent");
  });

  it("leaves the avatar unringed when nobody is in the order", () => {
    render(<PresenceIndicator {...base} rows={[]} />);
    expect(screen.getByTestId("assignee-avatar").getAttribute("data-presence")).toBe("none");
  });

  // design-system §4.17 D — colour is never the only carrier of meaning.
  it("names the person and the elapsed time in accessible text", () => {
    render(<PresenceIndicator {...base} rows={[agent]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/Salima/);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/5 min/);
  });

  it("shows a manager who is NOT the assignee as an extra head", () => {
    render(<PresenceIndicator {...base} rows={[manager]} />);
    const extra = screen.getAllByTestId("extra-presence");
    expect(extra).toHaveLength(1);
    expect(extra[0].getAttribute("data-mode")).toBe("viewing");
  });

  it("distinguishes a manager reading from a manager editing", () => {
    render(<PresenceIndicator {...base} rows={[{ ...manager, mode: "editing" }]} />);
    expect(screen.getByTestId("extra-presence").getAttribute("data-mode")).toBe("editing");
  });

  it("never draws a present person as the dashed unassigned placeholder", () => {
    // An unnamed head rendered as "+" reads as "unassigned, act on this"
    // everywhere else in the product — the opposite of "someone is in here".
    render(<PresenceIndicator {...base} rows={[{ ...manager, user_id: "ghost" }]} />);
    expect(screen.getByTestId("extra-presence").textContent).not.toBe("+");
  });

  it("ignores rows that have already expired", () => {
    const stale = { ...agent, expires_at: "2026-09-10T10:04:00.000Z" };
    render(<PresenceIndicator {...base} rows={[stale]} />);
    expect(screen.getByTestId("assignee-avatar").getAttribute("data-presence")).toBe("none");
  });

  it("still renders for an unassigned order with a manager inside", () => {
    render(<PresenceIndicator {...base} assigneeName={null} assigneeAvatarUrl={null} rows={[manager]} />);
    expect(screen.getByTestId("extra-presence")).toBeInTheDocument();
  });
});

describe("PresenceIndicator — typing", () => {
  it("shows the typing bubble on the assignee while they edit", () => {
    render(<PresenceIndicator {...base} rows={[{ ...agent, mode: "editing" }]} />);
    expect(screen.getByTestId("typing-dots")).toBeInTheDocument();
  });

  // The corner holds one mark or the other, never both.
  it("replaces the static live dot rather than sitting beside it", () => {
    const { container, rerender } = render(
      <PresenceIndicator {...base} rows={[{ ...agent, mode: "editing" }]} />,
    );
    expect(container.querySelectorAll("[data-live-dot]")).toHaveLength(0);

    rerender(<PresenceIndicator {...base} rows={[{ ...agent, mode: "viewing" }]} />);
    expect(screen.queryByTestId("typing-dots")).toBeNull();
    expect(container.querySelectorAll("[data-live-dot]")).toHaveLength(1);
  });

  it("shows it on a manager who is typing, not merely reading", () => {
    const { rerender } = render(
      <PresenceIndicator {...base} rows={[{ ...manager, mode: "editing" }]} />,
    );
    expect(screen.getByTestId("typing-dots")).toBeInTheDocument();

    rerender(<PresenceIndicator {...base} rows={[manager]} />);
    expect(screen.queryByTestId("typing-dots")).toBeNull();
  });
});
