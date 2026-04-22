import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Sidebar } from "@/components/layout/Sidebar";

const replaceMock = vi.fn();
let pathnameMock = "/fr/dashboard";
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => pathnameMock,
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
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
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

describe("Sidebar — market_manager", () => {
  it("renders Tableau de bord nav item", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
  });

  it("renders Commandes nav item", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText("Commandes")).toBeInTheDocument();
  });

  it("renders Produits nav item", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText("Produits")).toBeInTheDocument();
  });

  it("renders Performance nav item", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText("Performance")).toBeInTheDocument();
  });

  it("renders Paramètres nav item", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText("Paramètres")).toBeInTheDocument();
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

describe("Sidebar — unassigned badge", () => {
  it("shows unassigned count badge on Commandes item", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={12} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows zero count badge when unassignedCount is 0", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
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

describe("Sidebar — active nav item", () => {
  it("marks Commandes as active when currentPath is /fr/orders", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/orders" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Commandes/ });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marks Tableau de bord as active when currentPath is /fr/dashboard", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: "Tableau de bord" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Commandes as active when currentPath is /fr/dashboard", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    const link = screen.getByRole("link", { name: /Commandes/ });
    expect(link).not.toHaveAttribute("aria-current", "page");
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

describe("Sidebar — section headings", () => {
  it("renders the Opérations section heading", () => {
    render(<Sidebar user={managerUser} currentPath="/fr/dashboard" unassignedCount={0} />);
    expect(screen.getByText(/Opérations/i)).toBeInTheDocument();
  });
});
