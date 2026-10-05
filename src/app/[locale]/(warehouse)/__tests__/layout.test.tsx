import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import WarehouseLayout from "../layout";
import type { AuthUser } from "@/types";

let mockUser: AuthUser | null = null;

vi.mock("@/context/auth", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
let mockPathname = "/fr/warehouse/preparation";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(""),
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
// The real sidebar's bell calls useAlertsPanel().openPanel; the stand-in does
// the same, so the test proves the shell provides a panel to open.
vi.mock("@/components/layout/Sidebar", async () => {
  const { useAlertsPanel } = await import("@/context/alerts-panel");
  return {
    Sidebar: () => {
      const { openPanel } = useAlertsPanel();
      return (
        <nav data-testid="sidebar">
          <button type="button" onClick={() => openPanel()}>alerts</button>
        </nav>
      );
    },
  };
});
vi.mock("@/components/alerts/AlertsPanel", () => ({
  AlertsPanel: () => <div data-testid="alerts-panel" />,
}));

function user(role: string): AuthUser {
  return {
    id: "u1", email: "a@b.c", full_name: "A", role, market_id: "m1",
    avatar_url: null, locale: "fr", direction: "ltr",
  } as unknown as AuthUser;
}

afterEach(() => cleanup());

describe("Entrepôt shell — navigation", () => {
  it("gives a manager a working alerts bell on warehouse pages", async () => {
    // The warehouse shell had no AlertsPanelProvider, so the sidebar's bell
    // fell back to an empty default and did nothing on every Entrepôt page.
    mockUser = user("market_manager");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    fireEvent.click(screen.getByRole("button", { name: "alerts" }));
    // The panel is loaded with next/dynamic, so it lands a tick later.
    expect(await screen.findByTestId("alerts-panel")).toBeInTheDocument();
  });

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
    expect(screen.getByRole("link", { name: "Scanner" })).toBeInTheDocument();
  });

  it("follows the day: Aujourd'hui, Sortir, Scan in the centre, Rentrer, Stock", () => {
    // Aujourd'hui is home — the four jobs and their backlog. Sortir and Rentrer
    // are worked from; Stock holds Recevoir and Compter. Réglages moved behind
    // the avatar on Aujourd'hui: it is not a job (2026-10-02).
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    const bar = screen.getByTestId("wh-bottom-bar");
    const labels = Array.from(bar.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(labels).toEqual([
      "/fr/warehouse",
      "/fr/warehouse/out",
      "/fr/warehouse/out?scan=1",
      "/fr/warehouse/returns",
      "/fr/warehouse/stock",
    ]);
  });

  it("opens the scan sheet from the centre of the bar, on any screen", () => {
    // With a parcel in hand the sheet binds its sticker; with nothing in hand
    // it looks the sticker up. Runs start from a roll on Sortir.
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    expect(screen.getByRole("link", { name: "Scanner" })).toHaveAttribute("href", "/fr/warehouse/out?scan=1");
  });

  it("gives the count run the whole screen too", () => {
    mockUser = user("warehouse_agent");
    mockPathname = "/fr/warehouse/count";
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    mockPathname = "/fr/warehouse/preparation";
  });

  it("gives the run the whole screen: no tab bar, no floating button", () => {
    // Four destinations and a floating button under the thumb are four ways to
    // lose a batch while holding a parcel. The run carries its own exit.
    mockUser = user("warehouse_agent");
    mockPathname = "/fr/warehouse/scan";
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    expect(screen.queryByTestId("wh-scan-fab")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    // And nothing reserves space for a bar that is not there.
    expect(screen.getByTestId("wh-mobile-main").className).not.toMatch(/pb-\[/);
    mockPathname = "/fr/warehouse/preparation";
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
