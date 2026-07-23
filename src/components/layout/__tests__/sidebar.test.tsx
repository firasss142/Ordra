import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MarketScopeProvider } from "@/context/market-scope";

vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: vi.fn() }),
  };
});

function renderSidebar(ui: React.ReactElement) {
  return render(
    <MarketScopeProvider initialScope="tn">{ui}</MarketScopeProvider>,
  );
}

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
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("button", { name: /Accueil/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Commandes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Entrepôt/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clients/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Équipe/ })).toBeInTheDocument();
  });

  it("hides FINANCES section from market_manager (no canViewFinances)", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("button", { name: /Finances/ })).not.toBeInTheDocument();
  });

  it("shows FINANCES section for super_admin", () => {
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("button", { name: /Finances/ })).toBeInTheDocument();
  });

  it("hides SYSTÈME section from market_manager", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("button", { name: /Système/ })).not.toBeInTheDocument();
  });

  it("shows SYSTÈME section for super_admin", () => {
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("button", { name: /Système/ })).toBeInTheDocument();
  });

  it("expanding SYSTÈME reveals all sub-tabs for super_admin", () => {
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
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
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/settings/carriers" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Transporteurs/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("activates Marchés on /fr/markets", () => {
    pathnameMock = "/fr/markets";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/markets" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /^Marchés$/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("activates Journaux on /fr/admin/logs", async () => {
    pathnameMock = "/fr/admin/logs";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/admin/logs" unassignedCount={0} />);
    const link = await screen.findByRole("link", { name: /Journaux/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });
});

describe("Sidebar — default expanded sections", () => {
  it("expands ACCUEIL by default (shows Dashboard sub-tab)", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
  });

  it("expands FINANCES by default for super_admin (shows P&L global sub-tab)", () => {
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /P&L global/ })).toBeInTheDocument();
  });

  it("expands ÉQUIPE by default (shows Performance sub-tab)", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /^Performance$/ })).toBeInTheDocument();
  });

  it("renders En confirmation under ÉQUIPE (visible by default, not inside collapsed COMMANDES)", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    // ÉQUIPE is expanded by default while COMMANDES is collapsed — the
    // relocated analytics item is therefore immediately visible.
    expect(screen.getByRole("link", { name: /En confirmation/ })).toBeInTheDocument();
  });

  it("keeps COMMANDES collapsed by default (no À assigner sub-tab visible)", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("link", { name: /À assigner/ })).not.toBeInTheDocument();
  });
});

describe("Sidebar — accordion toggle", () => {
  it("expands COMMANDES when its header is clicked", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("link", { name: /À assigner/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Commandes/ }));
    expect(screen.getByRole("link", { name: /À assigner/ })).toBeInTheDocument();
  });

  it("collapses ACCUEIL when its header is clicked (while on a non-accueil route)", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    const accueilHeader = screen.getByRole("button", { name: /Accueil/ });
    // ACCUEIL is expanded by default; Dashboard sub-tab is visible
    expect(accueilHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
    fireEvent.click(accueilHeader);
    expect(accueilHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Dashboard/ })).not.toBeInTheDocument();
  });
});

describe("Sidebar — active route auto-expand", () => {
  it("auto-expands ENTREPÔT when on /fr/warehouse/preparation", () => {
    pathnameMock = "/fr/warehouse/preparation";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/warehouse/preparation" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /Préparation/ })).toBeInTheDocument();
  });

  it("marks Préparation active on /fr/warehouse/preparation", () => {
    pathnameMock = "/fr/warehouse/preparation";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/warehouse/preparation" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Préparation/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marks Retours active on /fr/warehouse/returns", () => {
    pathnameMock = "/fr/warehouse/returns";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/warehouse/returns" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Retours/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marks Journal entrepôt active on /fr/warehouse/history", () => {
    pathnameMock = "/fr/warehouse/history";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/warehouse/history" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Journal entrepôt/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("activates FINANCES (not ACCUEIL) on /fr/dashboard/pnl for super_admin", () => {
    pathnameMock = "/fr/dashboard/pnl";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard/pnl" unassignedCount={0} />);
    const pnlLink = screen.getByRole("link", { name: /P&L global/ });
    expect(pnlLink).toHaveAttribute("aria-current", "page");
    const pulseLink = screen.getByRole("link", { name: /Dashboard/ });
    expect(pulseLink).not.toHaveAttribute("aria-current", "page");
  });

  it("auto-expands COMMANDES when on /fr/orders?preset=unassigned", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("preset=unassigned");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    expect(screen.getByRole("link", { name: /À assigner/ })).toBeInTheDocument();
  });

  it("auto-expands COMMANDES when on /fr/orders with no filter", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    // Section expanded via path-prefix match — sub-items are rendered
    expect(screen.getByRole("link", { name: /À assigner/ })).toBeInTheDocument();
  });

  it("marks À assigner active on /fr/assign", () => {
    pathnameMock = "/fr/assign";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/assign" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /À assigner/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("does not mark À assigner active on bare /fr/orders", () => {
    pathnameMock = "/fr/orders";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /À assigner/ });
    expect(link).not.toHaveAttribute("aria-current", "page");
  });
});

describe("Sidebar — badge on unassigned", () => {
  it("shows the badge count on À assigner sub-tab when COMMANDES is expanded", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={12} />);
    fireEvent.click(screen.getByRole("button", { name: /Commandes/ }));
    const link = screen.getByRole("link", { name: /À assigner/ });
    expect(within(link).getByText("12")).toBeInTheDocument();
  });

  it("shows the badge on the COMMANDES section header when collapsed", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={7} />);
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
  it("marks Dashboard as active when currentPath is /fr/dashboard with no query", () => {
    pathnameMock = "/fr/dashboard";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Dashboard/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Dashboard as active when on /fr/dashboard/alerts", () => {
    pathnameMock = "/fr/dashboard/alerts";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard/alerts" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Dashboard/ });
    expect(link).not.toHaveAttribute("aria-current", "page");
  });

  it("marks Alertes as active when on /fr/dashboard/alerts", () => {
    pathnameMock = "/fr/dashboard/alerts";
    searchParamsMock = new URLSearchParams("");
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard/alerts" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Alertes/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });
});

describe("Sidebar — user menu and logout", () => {
  it("opens the user menu when the user block is clicked", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.queryByRole("menuitem", { name: "Déconnexion" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sarah Ben Ali/i }));
    expect(screen.getByRole("menuitem", { name: "Déconnexion" })).toBeInTheDocument();
  });

  it("calls /api/auth/logout and redirects to /fr/login when Déconnexion clicked", async () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
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
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText(/market manager/i)).toBeInTheDocument();
  });
});

describe("Sidebar — brand area", () => {
  it("shows Tunisie market pill for tn manager", () => {
    renderSidebar(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText(/Tunisie/)).toBeInTheDocument();
  });

  it("shows the market scope switcher for super_admin (defaults to TN per provider)", () => {
    renderSidebar(<Sidebar user={superAdminAllMarkets} currentPath="/fr/dashboard" unassignedCount={0} />);
    // The brand area renders the scope switcher trigger, which reflects the active scope label.
    // Provider initial scope is "tn" in tests, so the trigger shows the Tunisia label.
    expect(screen.getByRole("button", { name: /Marché/ })).toHaveTextContent(/Tunisie/);
  });
});
