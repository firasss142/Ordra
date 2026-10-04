import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SidebarFrame } from "@/components/layout/SidebarFrame";
import type { AuthUser } from "@/types";

// The frame owns the rail choice and the drawer; the sidebar only asks.
vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: (p: { rail?: boolean; mobileOpen?: boolean; onToggleRail?: () => void; onMobileOpen?: () => void; onMobileClose?: () => void }) => (
    <nav data-testid="sidebar" data-rail={String(!!p.rail)} data-open={String(!!p.mobileOpen)}>
      <button type="button" onClick={p.onToggleRail}>toggle</button>
      <button type="button" onClick={p.onMobileOpen}>open</button>
      <button type="button" onClick={p.onMobileClose}>close</button>
    </nav>
  ),
}));

const user = {
  id: "u", email: "a@b.c", full_name: "A", avatar_url: null,
  role: "market_manager", market_id: "m", locale: "fr", direction: "ltr",
} as AuthUser;

const originalMatchMedia = window.matchMedia;
function screenWidth(px: number) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? Infinity);
    return { matches: px <= max, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

const renderFrame = () =>
  render(
    <SidebarFrame user={user}>
      <p>page</p>
    </SidebarFrame>,
  );
const main = () => screen.getByRole("main");

describe("SidebarFrame", () => {
  it("gives the page the room the bar leaves — 240 px on a wide screen", () => {
    screenWidth(1440);
    renderFrame();
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-rail", "false");
    expect(main().parentElement).toHaveStyle({ "--sidebar-w": "240px" });
    expect(main()).toHaveTextContent("page");
  });

  it("starts as the 64 px rail below 1280 px, where the tables need the width", () => {
    screenWidth(1180);
    renderFrame();
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-rail", "true");
    expect(main().parentElement).toHaveStyle({ "--sidebar-w": "64px" });
  });

  it("remembers the person's choice over the default", () => {
    screenWidth(1180);
    renderFrame();
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-rail", "false");
    cleanup();
    renderFrame();
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-rail", "false");
  });

  it("opens and closes the phone drawer", () => {
    screenWidth(390);
    renderFrame();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "true");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "false");
  });

  it("no longer floats its own ☰ over the page — the sidebar's top bar carries it", () => {
    screenWidth(390);
    renderFrame();
    expect(screen.queryByRole("button", { name: "Menu" })).not.toBeInTheDocument();
  });
});
