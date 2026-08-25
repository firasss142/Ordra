import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import WarehouseLayout from "../layout";
import type { AuthUser } from "@/types";

let mockUser: AuthUser | null = null;

vi.mock("@/context/auth", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/fr/warehouse/preparation",
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("swr", () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false }),
  preload: vi.fn(),
}));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

// The shells are exercised elsewhere; here we only care which one appears.
vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <nav data-testid="sidebar" />,
}));
vi.mock("@/components/layout/Topbar", () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

function user(role: string): AuthUser {
  return {
    id: "u1", email: "a@b.c", full_name: "A", role, market_id: "m1",
    avatar_url: null, locale: "fr", direction: "ltr",
  } as unknown as AuthUser;
}

afterEach(() => cleanup());

describe("Entrepôt shell — navigation", () => {
  it("gives a manager the sidebar and no tab band", () => {
    mockUser = user("market_manager");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    // The band repeated the sidebar's own ENTREPÔT group, one row below it.
    expect(screen.queryByTestId("wh-tabs")).toBeNull();
  });

  it("gives a super_admin the sidebar and no tab band", () => {
    mockUser = user("super_admin");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("wh-tabs")).toBeNull();
  });

  it("navigates a warehouse agent from the bottom, where a thumb reaches", () => {
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    // Sidebar renders null for this role, so this bar is the agent's entire
    // navigation. It replaced the top band: an agent holds the phone in one
    // hand and a parcel in the other, and the top edge is out of reach.
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.getByTestId("wh-bottom-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("wh-tabs")).toBeNull();
  });

  it("gives the agent the scan button on every screen but the scanner", () => {
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    expect(screen.getByTestId("wh-scan-fab")).toBeInTheDocument();
  });

  it("gives the agent no top bar — the mockups start with the page title", () => {
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    // 56px of chrome that carried a market badge the agent cannot change and
    // an avatar menu that now lives in Réglages. Three of the four mockups
    // have no header at all.
    expect(screen.queryByTestId("topbar")).toBeNull();
  });

  it("navigates to the four sections the mockups show", () => {
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    const bar = screen.getByTestId("wh-bottom-bar");
    const labels = Array.from(bar.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(labels).toEqual([
      "/fr/warehouse",
      "/fr/warehouse/stock",
      "/fr/warehouse/returns",
      "/fr/warehouse/settings",
    ]);
  });

  it("leaves room under the page for the bar, so the last row is reachable", () => {
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    // Without this the final card sits behind the fixed bar and cannot be
    // tapped — the classic bottom-navigation bug.
    expect(screen.getByTestId("wh-mobile-main").className).toMatch(/pb-\[/);
  });

  it("renders the page in every shell", () => {
    for (const role of ["market_manager", "warehouse_agent"]) {
      mockUser = user(role);
      const { unmount } = render(<WarehouseLayout><div>page</div></WarehouseLayout>);
      expect(screen.getByText("page")).toBeInTheDocument();
      unmount();
    }
  });
});
