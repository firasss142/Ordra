import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { Sidebar } from "@/components/layout/Sidebar";

const replaceMock = vi.fn();
let pathnameMock = "/fr/dashboard";
let searchParamsMock = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => pathnameMock,
  useSearchParams: () => searchParamsMock,
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

beforeEach(() => {
  replaceMock.mockReset();
  pathnameMock = "/fr/dashboard";
  searchParamsMock = new URLSearchParams("");
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

const managerUser = {
  id: "user-1",
  email: "manager@oms.tn",
  full_name: "Sarah Ben Ali",
  avatar_url: null,
  role: "market_manager" as const,
  market_id: "00000000-0000-0000-0000-000000000001",
  locale: "fr" as const,
  direction: "ltr" as const,
};

const superAdminAllMarkets = {
  ...managerUser,
  id: "user-3",
  email: "admin@oms.local",
  full_name: "Admin User",
  role: "super_admin" as const,
  market_id: null,
};

const agentUser = {
  id: "user-2",
  email: "agent@oms.tn",
  full_name: "Ali Trabelsi",
  avatar_url: null,
  role: "agent" as const,
  market_id: "00000000-0000-0000-0000-000000000001",
  locale: "fr" as const,
  direction: "ltr" as const,
};

describe("Sidebar — sections", () => {
  it("renders the 5 permitted non-admin sections for market_manager", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("button", { name: /Accueil/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Commandes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Logistique/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clients/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Équipe/ })).toBeInTheDocument();
  });

  it("hides FINANCES section from market_manager (no canViewFinances)", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("button", { name: /Finances/ })).not.toBeInTheDocument();
  });

  it("shows FINANCES section for super_admin", () => {
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("button", { name: /Finances/ })).toBeInTheDocument();
  });

  it("hides SYSTÈME section from market_manager", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("button", { name: /Système/ })).not.toBeInTheDocument();
  });

  it("shows SYSTÈME section for super_admin", () => {
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("button", { name: /Système/ })).toBeInTheDocument();
  });

  it("expanding SYSTÈME reveals all sub-tabs for super_admin", () => {
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /Système/ }));
    expect(screen.getByRole("link", { name: /^Marchés$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Storefronts$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Transporteurs/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Paramètres$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Journaux/ })).toBeInTheDocument();
  });

  it("activates Transporteurs on /fr/settings/carriers (super_admin)", () => {
    pathnameMock = "/fr/settings/carriers";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/settings/carriers" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Transporteurs/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("activates Marchés on /fr/markets", () => {
    pathnameMock = "/fr/markets";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/markets" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /^Marchés$/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("activates Journaux on /fr/admin/logs", async () => {
    pathnameMock = "/fr/admin/logs";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/admin/logs" unassignedCount={0} />);
    const link = await screen.findByRole("link", { name: /Journaux/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });
});

describe("Sidebar — default expanded sections", () => {
  it("expands ACCUEIL by default (shows Pulse sub-tab)", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /Pulse/ })).toBeInTheDocument();
  });

  it("expands FINANCES by default for super_admin (shows P&L global sub-tab)", () => {
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /P&L global/ })).toBeInTheDocument();
  });

  it("expands ÉQUIPE by default (shows Performance sub-tab)", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /^Performance$/ })).toBeInTheDocument();
  });

  it("keeps COMMANDES collapsed by default (no À assigner sub-tab visible)", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("link", { name: /À assigner/ })).not.toBeInTheDocument();
  });
});

describe("Sidebar — accordion toggle", () => {
  it("expands COMMANDES when its header is clicked", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("link", { name: /À assigner/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Commandes/ }));
    expect(screen.getByRole("link", { name: /À assigner/ })).toBeInTheDocument();
  });

  it("collapses ACCUEIL when its header is clicked (while on a non-accueil route)", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    const accueilHeader = screen.getByRole("button", { name: /Accueil/ });
    // ACCUEIL is expanded by default; Pulse sub-tab is visible
    expect(accueilHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Pulse/ })).toBeInTheDocument();
    fireEvent.click(accueilHeader);
    expect(accueilHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Pulse/ })).not.toBeInTheDocument();
  });
});

describe("Sidebar — active route auto-expand", () => {
  it("auto-expands LOGISTIQUE when on /fr/warehouse/to-label", () => {
    pathnameMock = "/fr/warehouse/to-label";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/warehouse/to-label" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /Préparation/ })).toBeInTheDocument();
  });

  it("marks Préparation active on /fr/warehouse/to-label", () => {
    pathnameMock = "/fr/warehouse/to-label";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/warehouse/to-label" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Préparation/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marks Retours active on /fr/warehouse/returns", () => {
    pathnameMock = "/fr/warehouse/returns";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/warehouse/returns" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Retours/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marks Journal entrepôt active on /fr/warehouse/history", () => {
    pathnameMock = "/fr/warehouse/history";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/warehouse/history" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Journal entrepôt/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("activates FINANCES (not ACCUEIL) on /fr/dashboard/pnl for super_admin", () => {
    pathnameMock = "/fr/dashboard/pnl";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard/pnl" unassignedCount={0} />);
    const pnlLink = screen.getByRole("link", { name: /P&L global/ });
    expect(pnlLink).toHaveAttribute("aria-current", "page");
    const pulseLink = screen.getByRole("link", { name: /Pulse/ });
    expect(pulseLink).not.toHaveAttribute("aria-current", "page");
  });

  it("auto-expands COMMANDES when on /fr/orders?preset=unassigned", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("preset=unassigned");
    render(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /À assigner/ })).toBeInTheDocument();
  });

  it("auto-expands COMMANDES when on /fr/orders with no filter", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    // Section expanded via path-prefix match — sub-items are rendered
    expect(screen.getByRole("link", { name: /À assigner/ })).toBeInTheDocument();
  });

  it("marks À assigner active on /fr/assign", () => {
    pathnameMock = "/fr/assign";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/assign" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /À assigner/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("does not mark À assigner active on bare /fr/orders", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /À assigner/ });
    expect(link).not.toHaveAttribute("aria-current", "page");
  });
});

describe("Sidebar — badge on unassigned", () => {
  it("shows the badge count on À assigner sub-tab when COMMANDES is expanded", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={12} />);
    fireEvent.click(screen.getByRole("button", { name: /Commandes/ }));
    const link = screen.getByRole("link", { name: /À assigner/ });
    expect(within(link).getByText("12")).toBeInTheDocument();
  });

  it("shows the badge on the COMMANDES section header when collapsed", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={7} />);
    const header = screen.getByRole("button", { name: /Commandes/ });
    expect(within(header).getByText("7")).toBeInTheDocument();
  });
});

describe("Sidebar — agent role", () => {
  it("returns null for agent role", () => {
    const { container } = render(
      <Sidebar user={agentUser} currentPath="/fr/queue" unassignedCount={0} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("Sidebar — active sub-tab", () => {
  it("marks Pulse as active when currentPath is /fr/dashboard with no query", () => {
    pathnameMock = "/fr/dashboard";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Pulse/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Pulse as active when on /fr/dashboard/alerts", () => {
    pathnameMock = "/fr/dashboard/alerts";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard/alerts" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Pulse/ });
    expect(link).not.toHaveAttribute("aria-current", "page");
  });

  it("marks Alertes as active when on /fr/dashboard/alerts", () => {
    pathnameMock = "/fr/dashboard/alerts";
    searchParamsMock = new URLSearchParams("");
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard/alerts" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Alertes/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });
});

describe("Sidebar — user menu and logout", () => {
  it("opens the user menu when the user block is clicked", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("menuitem", { name: "Déconnexion" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sarah Ben Ali/i }));
    expect(screen.getByRole("menuitem", { name: "Déconnexion" })).toBeInTheDocument();
  });

  it("calls /api/auth/logout and redirects to /fr/login when Déconnexion clicked", async () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /Sarah Ben Ali/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Déconnexion" }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/logout",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/fr/login");
    });
  });

  it("renders the role label on the user block", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText(/market manager/i)).toBeInTheDocument();
  });
});

describe("Sidebar — brand area", () => {
  it("shows Tunisie market pill for tn manager", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText(/Tunisie/)).toBeInTheDocument();
  });

  it("shows 'Tous les marchés' for super_admin with null market_id", () => {
    render(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText(/Tous les marchés/)).toBeInTheDocument();
  });
});
