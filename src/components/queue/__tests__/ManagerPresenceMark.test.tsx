import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManagerPresenceMark } from "../ManagerPresenceMark";

const NOW = new Date("2026-09-10T10:05:00.000Z");
const row = {
  order_id: "o-1",
  user_id: "m-1",
  role: "market_manager" as const,
  mode: "viewing" as const,
  opened_at: "2026-09-10T10:02:00.000Z",
  expires_at: "2026-09-10T10:06:00.000Z",
  full_name: "Imen",
  avatar_url: null,
};

describe("ManagerPresenceMark", () => {
  it("renders nothing when nobody is on the order", () => {
    const { container } = render(<ManagerPresenceMark rows={[]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the manager and says they are only reading", () => {
    render(<ManagerPresenceMark rows={[row]} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/Imen/);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/consulte/);
  });

  it("says modifie once the manager actually changes something", () => {
    render(<ManagerPresenceMark rows={[{ ...row, mode: "editing" }]} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/modifie/);
    expect(screen.getByRole("img").getAttribute("data-mode")).toBe("editing");
  });

  // The agent is never blocked, so this must not look like a warning.
  it("marks itself advisory, never blocking", () => {
    render(<ManagerPresenceMark rows={[row]} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("data-blocking")).toBe("false");
  });

  it("ignores expired rows", () => {
    const stale = { ...row, expires_at: "2026-09-10T10:04:00.000Z" };
    const { container } = render(<ManagerPresenceMark rows={[stale]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to generic copy when the manager has no name", () => {
    render(<ManagerPresenceMark rows={[{ ...row, full_name: null }]} now={NOW} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/responsable/i);
  });

  it("shows several people at once", () => {
    render(
      <ManagerPresenceMark
        rows={[row, { ...row, user_id: "m-2", full_name: "Firas" }]}
        now={NOW}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
