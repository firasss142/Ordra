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

  it("keeps the tab band for a warehouse agent, who has no sidebar at all", () => {
    mockUser = user("warehouse_agent");
    render(<WarehouseLayout><div>page</div></WarehouseLayout>);
    // Sidebar renders null for this role, so removing the band here would
    // leave the agent with no way to reach another screen.
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.getByTestId("wh-tabs")).toBeInTheDocument();
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
