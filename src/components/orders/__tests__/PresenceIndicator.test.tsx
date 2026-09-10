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

describe("PresenceIndicator", () => {
  it("renders nothing when nobody is present", () => {
    const { container } = render(<PresenceIndicator rows={[]} nameOf={() => null} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  // design-system §4.17 D: a colour signal must never be the only carrier of
  // meaning — it has to survive greyscale and a screen reader.
  it("names the holder and the elapsed time in accessible text", () => {
    render(<PresenceIndicator rows={[agent]} nameOf={() => "Salima"} now={NOW} />);
    const el = screen.getByRole("img");
    expect(el.getAttribute("aria-label")).toMatch(/Salima/);
    expect(el.getAttribute("aria-label")).toMatch(/5 min/);
  });

  it("marks an agent as blocking and a manager as not", () => {
    const { rerender } = render(<PresenceIndicator rows={[agent]} nameOf={() => "Salima"} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("data-blocking")).toBe("true");

    rerender(<PresenceIndicator rows={[manager]} nameOf={() => "Imen"} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("data-blocking")).toBe("false");
  });

  it("distinguishes consulte from modifie", () => {
    const { rerender } = render(<PresenceIndicator rows={[manager]} nameOf={() => "Imen"} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("data-mode")).toBe("viewing");

    rerender(<PresenceIndicator rows={[{ ...manager, mode: "editing" }]} nameOf={() => "Imen"} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("data-mode")).toBe("editing");
  });

  it("puts the blocking agent first when several people are present", () => {
    render(<PresenceIndicator rows={[manager, agent]} nameOf={(id) => (id === "a-1" ? "Salima" : "Imen")} now={NOW} />);
    expect(screen.getAllByRole("img")[0].getAttribute("data-blocking")).toBe("true");
  });

  it("ignores rows that have already expired", () => {
    const stale = { ...agent, expires_at: "2026-09-10T10:04:00.000Z" };
    const { container } = render(<PresenceIndicator rows={[stale]} nameOf={() => "Salima"} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});
