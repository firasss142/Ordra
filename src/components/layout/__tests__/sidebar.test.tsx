import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import { Sidebar } from "@/components/layout/Sidebar";
import { MarketScopeProvider } from "@/context/market-scope";
import { LY_MARKET_ID, TN_MARKET_ID } from "@/lib/markets";

/*
 * The manager / super_admin sidebar, rebuilt from prototypes/sidebar-v2.html:
 * pinned head (Ordra, alerts, market card, « Aller à… ») and foot (profile,
 * collapse), only the list scrolls, Dashboard on its own, quiet group labels
 * that remember being folded, a 64 px rail, and a top bar + drawer on phones.
 */

vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return { ...actual, useSWRConfig: () => ({ mutate: vi.fn() }) };
});

const replaceMock = vi.fn();
const pushMock = vi.fn();
let pathnameMock = "/fr/dashboard";
let searchParamsMock = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, prefetch: vi.fn(), refresh: vi.fn() }),
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

vi.mock("@/context/alerts-panel", () => ({ useAlertsPanel: () => ({ openPanel: vi.fn() }) }));

const originalMatchMedia = window.matchMedia;
function asPhone() {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes("max-width: 767px"),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  replaceMock.mockReset();
  pushMock.mockReset();
  pathnameMock = "/fr/dashboard";
  searchParamsMock = new URLSearchParams("");
  localStorage.clear();
  document.cookie = "oms_scope_market=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

const managerUser = {
  id: "user-1",
  email: "manager@oms.tn",
  full_name: "Sarah Ben Ali",
  avatar_url: null,
  role: "market_manager" as const,
  market_id: TN_MARKET_ID,
  locale: "fr" as const,
  direction: "ltr" as const,
};
const superAdmin = {
  ...managerUser,
  id: "user-3",
  email: "admin@oms.local",
  full_name: "Admin User",
  role: "super_admin" as const,
  market_id: null,
};
const agentUser = { ...managerUser, id: "user-2", role: "agent" as const };

type Props = React.ComponentProps<typeof Sidebar>;
function renderSidebar(props: Partial<Props> & { user: Props["user"] }, scope: "tn" | "ly" | "all" = "tn") {
  const path = props.currentPath ?? pathnameMock;
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MarketScopeProvider initialScope={scope}>
        <Sidebar currentPath={path} unassignedCount={0} {...props} />
      </MarketScopeProvider>
    </SWRConfig>,
  );
}
const at = (path: string, search = "") => {
  pathnameMock = path;
  searchParamsMock = new URLSearchParams(search);
};
const groupLinks = (linkName: RegExp) =>
  Array.from(screen.getByRole("link", { name: linkName }).closest("ul")?.querySelectorAll("a") ?? []).map((a) =>
    a.getAttribute("href"),
  );

describe("Sidebar — what each role sees", () => {
  it("gives a market_manager Dashboard on its own, then the groups of their day", () => {
    renderSidebar({ user: managerUser });
    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("href", "/fr/dashboard");
    for (const g of ["Commandes", "Entrepôt", "Livraison", "Finances", "Clients", "Équipe", "Système"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${g}`) })).toHaveAttribute("aria-expanded", "true");
    }
    expect(screen.queryByRole("button", { name: /Accueil/ })).not.toBeInTheDocument();
  });

  it("opens Finances to a market_manager for Achats and Produits & marges only (owner, 2026-10-04)", () => {
    renderSidebar({ user: managerUser });
    expect(screen.getByRole("link", { name: "Achats" })).toHaveAttribute("href", "/fr/finance/purchases");
    expect(screen.getByRole("link", { name: "Produits & marges" })).toHaveAttribute("href", "/fr/products");
    expect(screen.queryByRole("link", { name: "P&L global" })).not.toBeInTheDocument();
  });

  it("adds Finances for a super_admin", () => {
    renderSidebar({ user: superAdmin });
    expect(screen.getByRole("button", { name: /^Finances/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "P&L global" })).toHaveAttribute("href", "/fr/dashboard/pnl");
  });

  it("keeps ENTREPÔT to the day: Aujourd'hui, then the jobs in their order", () => {
    renderSidebar({ user: superAdmin });
    expect(groupLinks(/^Aujourd'hui$/)).toEqual([
      "/fr/warehouse",
      "/fr/warehouse/out",
      "/fr/warehouse/returns",
      "/fr/warehouse/stock",
    ]);
  });

  it("LIVRAISON is the worklist — the two old boards are gone, Transporteurs moved to Performance", () => {
    renderSidebar({ user: superAdmin });
    expect(groupLinks(/^Suivi livraison$/)).toEqual(["/fr/delivery"]);
    expect(screen.queryByRole("link", { name: /Suivi transporteur/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Tableau livraison/ })).not.toBeInTheDocument();
  });

  it("PERFORMANCE judges a period: Commandes, Équipe, Livraison", () => {
    renderSidebar({ user: managerUser });
    expect(screen.getByRole("button", { name: /^Performance/ })).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/fr/performance/orders", "/fr/team/performance", "/fr/carriers"]));
  });

  it("separates the floor's stock screen from the capital one, and hides the latter from a manager", () => {
    renderSidebar({ user: superAdmin });
    expect(screen.getByRole("link", { name: /^Stock$/ })).toHaveAttribute("href", "/fr/warehouse/stock");
    expect(screen.getByRole("link", { name: /Stock & inventaire/ })).toHaveAttribute("href", "/fr/dashboard/stock");
    cleanup();
    renderSidebar({ user: managerUser });
    expect(screen.getByRole("link", { name: /^Stock$/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Stock & inventaire/ })).not.toBeInTheDocument();
  });

  it("gives a manager Réglages only under SYSTÈME; a super_admin also gets Journaux", () => {
    renderSidebar({ user: managerUser });
    expect(screen.getByRole("link", { name: /^Réglages$/ })).toHaveAttribute("href", "/fr/system/settings");
    expect(screen.queryByRole("link", { name: /Journaux/ })).not.toBeInTheDocument();
    cleanup();
    renderSidebar({ user: superAdmin });
    expect(screen.getByRole("link", { name: /Journaux/ })).toHaveAttribute("href", "/fr/system/logs");
  });

  it("drops the ADMIN chip — it told the super admin what they already knew, and cut « SYSTÈME » short", () => {
    renderSidebar({ user: superAdmin });
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("returns null for an agent", () => {
    const { container } = renderSidebar({ user: agentUser });
    expect(container.firstChild).toBeNull();
  });
});

describe("Sidebar — folding", () => {
  it("opens every group on the first visit", () => {
    renderSidebar({ user: managerUser });
    expect(screen.getByRole("link", { name: /Archivées/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Salle de contrôle$/ })).toBeInTheDocument();
  });

  it("folds a group from its label, and remembers it on the next visit", () => {
    renderSidebar({ user: managerUser });
    const label = screen.getByRole("button", { name: /^Commandes/ });
    fireEvent.click(label);
    expect(label).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Archivées/ })).not.toBeInTheDocument();
    cleanup();
    renderSidebar({ user: managerUser });
    expect(screen.getByRole("button", { name: /^Commandes/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("always opens the group of the current page, even one the person folded", async () => {
    localStorage.setItem("ordra.sidebar.collapsed", JSON.stringify(["commandes"]));
    at("/fr/orders", "preset=unassigned");
    renderSidebar({ user: managerUser, currentPath: "/fr/orders" });
    expect(await screen.findByRole("link", { name: /Archivées/ })).toBeInTheDocument();
  });

  it("lifts a folded group's count onto its label", async () => {
    renderSidebar({ user: managerUser, unassignedCount: 7 });
    const label = screen.getByRole("button", { name: /^Commandes/ });
    fireEvent.click(label);
    expect(within(label).getByText("7")).toBeInTheDocument();
    expect(label).toHaveAccessibleName(/7 commandes non assignées/);
  });
});

describe("Sidebar — the current page", () => {
  it("marks Dashboard on /fr/dashboard and nowhere below it", () => {
    renderSidebar({ user: managerUser, currentPath: "/fr/dashboard" });
    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
    cleanup();
    at("/fr/dashboard/stock");
    renderSidebar({ user: managerUser, currentPath: "/fr/dashboard/stock" });
    expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
  });

  it("marks P&L, not Dashboard, on /fr/dashboard/pnl", () => {
    at("/fr/dashboard/pnl");
    renderSidebar({ user: superAdmin, currentPath: "/fr/dashboard/pnl" });
    expect(screen.getByRole("link", { name: "P&L global" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
  });

  it.each([
    ["/fr/warehouse", "", /^Aujourd'hui$/],
    ["/fr/warehouse/returns", "", /^Rentrer$/],
    ["/fr/warehouse/scan", "", /^Sortir$/],
    ["/fr/warehouse/stock/p1", "", /^Stock$/],
    ["/fr/warehouse/count", "", /^Stock$/],
    ["/fr/messages/templates", "", /^Messages/],
    ["/fr/system/settings/delivery", "", /^Réglages$/],
  ])("marks the right link on %s?%s", (path, search, name) => {
    at(path, search);
    renderSidebar({ user: managerUser, currentPath: path });
    expect(screen.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
  });

  it("marks Commandes on /fr/orders?preset=unassigned, not Performance › Commandes", () => {
    at("/fr/orders", "preset=unassigned");
    renderSidebar({ user: managerUser, currentPath: "/fr/orders" });
    const links = screen.getAllByRole("link", { name: /^Commandes/ });
    expect(links.find((a) => a.getAttribute("href") === "/fr/orders")).toHaveAttribute("aria-current", "page");
    expect(links.find((a) => a.getAttribute("href") === "/fr/performance/orders")).not.toHaveAttribute("aria-current");
  });

  it("marks only Aujourd'hui on /fr/warehouse", () => {
    at("/fr/warehouse");
    renderSidebar({ user: managerUser, currentPath: "/fr/warehouse" });
    expect(screen.getByRole("link", { name: /^Sortir$/ })).not.toHaveAttribute("aria-current");
  });

  it("activates Journaux on /fr/system/logs", () => {
    at("/fr/system/logs");
    renderSidebar({ user: superAdmin, currentPath: "/fr/system/logs" });
    expect(screen.getByRole("link", { name: /Journaux/ })).toHaveAttribute("aria-current", "page");
  });
});

describe("Sidebar — counts", () => {
  it("counts unassigned orders on Commandes", () => {
    renderSidebar({ user: managerUser, unassignedCount: 12 });
    const orders = screen.getAllByRole("link", { name: /^Commandes/ }).find((a) => a.getAttribute("href") === "/fr/orders")!;
    expect(within(orders).getByText("12")).toBeInTheDocument();
  });

  it("counts the super_admin's chosen market, as the WhatsApp count already did", async () => {
    renderSidebar({ user: superAdmin, unassignedCount: undefined }, "ly");
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(`/api/orders/unassigned/count?market_id=${LY_MARKET_ID}`),
    );
  });

  it("counts a manager's own market", async () => {
    renderSidebar({ user: managerUser, unassignedCount: undefined });
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(`/api/orders/unassigned/count?market_id=${TN_MARKET_ID}`),
    );
  });

  function mockUrls(map: Record<string, unknown>) {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.keys(map).find((k) => url.startsWith(k));
      return { ok: true, json: async () => (hit ? map[hit] : {}) } as Response;
    }) as unknown as typeof fetch;
  }

  it("counts unread WhatsApp orphans in green, on Messages and on a folded CLIENTS", async () => {
    mockUrls({ "/api/whatsapp/conversations/unread-count": { count: 3 } });
    renderSidebar({ user: managerUser });
    const link = screen.getByRole("link", { name: /^Messages/ });
    expect(await within(link).findByText("3")).toHaveStyle({ backgroundColor: "var(--badge-success-bg)" });
    const label = screen.getByRole("button", { name: /^Clients/ });
    fireEvent.click(label);
    expect(within(label).getByText("3")).toHaveStyle({ color: "var(--badge-success-fg)" });
  });

  it("scopes the WhatsApp count to the super_admin's market", async () => {
    mockUrls({});
    renderSidebar({ user: superAdmin }, "ly");
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(`/api/whatsapp/conversations/unread-count?market_id=${LY_MARKET_ID}`),
    );
  });

  it("counts open Journaux problems in red; a manager never asks", async () => {
    mockUrls({ "/api/admin/journal/counts": { open: 5, critical: 5 } });
    renderSidebar({ user: superAdmin }, "all");
    const link = screen.getByRole("link", { name: /Journaux/ });
    expect(await within(link).findByText("5")).toHaveStyle({ backgroundColor: "var(--badge-critical-bg)" });
    cleanup();
    mockUrls({ "/api/admin/journal/counts": { open: 5, critical: 5 } });
    renderSidebar({ user: managerUser });
    await new Promise((r) => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalledWith("/api/admin/journal/counts", expect.anything());
    expect(global.fetch).not.toHaveBeenCalledWith("/api/admin/journal/counts");
  });
});

describe("Sidebar — head", () => {
  it("carries the wordmark and the alerts button, not an Alertes link", () => {
    renderSidebar({ user: managerUser });
    expect(screen.getByText("Ordra")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alertes/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Alertes/ })).not.toBeInTheDocument();
  });

  it("names the manager's market on a read-only card, with a drawn flag rather than an emoji", () => {
    renderSidebar({ user: managerUser });
    const card = screen.getByLabelText("Marché actuel : Tunisie");
    expect(card.querySelector("svg")).not.toBeNull();
    expect(card).not.toHaveTextContent("🇹🇳");
  });

  it("gives the super_admin the market card as a control", () => {
    renderSidebar({ user: superAdmin });
    expect(screen.getByRole("button", { name: /Marché actuel/ })).toHaveTextContent(/Tunisie/);
  });
});

describe("Sidebar — Aller à…", () => {
  it("opens from its button and from ⌘K / Ctrl K, and goes where it is told", () => {
    renderSidebar({ user: managerUser });
    fireEvent.click(screen.getByRole("button", { name: /Aller à/ }));
    expect(screen.getByRole("dialog", { name: /Aller à/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Aller à/ })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "salle" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/fr/team");
  });

  it("offers the market switch to a super_admin, never to a manager", () => {
    renderSidebar({ user: superAdmin });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.click(screen.getByRole("option", { name: /Passer à Libye/ }));
    expect(document.cookie).toContain("oms_scope_market=ly");
    cleanup();
    renderSidebar({ user: managerUser });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.queryByRole("option", { name: /Passer à/ })).not.toBeInTheDocument();
  });
});

describe("Sidebar — foot", () => {
  it("opens the profile menu: Mon profil, finally linked, and Déconnexion", async () => {
    renderSidebar({ user: managerUser });
    fireEvent.click(screen.getByRole("button", { name: /Sarah Ben Ali/ }));
    expect(screen.getByRole("menuitem", { name: "Mon profil" })).toHaveAttribute("href", "/fr/profile");
    fireEvent.click(screen.getByRole("menuitem", { name: "Déconnexion" }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" })),
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/fr/login"));
  });

  it("shows the role under the name", () => {
    renderSidebar({ user: managerUser });
    expect(screen.getByText(/market manager/i)).toBeInTheDocument();
  });

  it("collapses to the rail from its button and from the [ key — not while typing", () => {
    const onToggleRail = vi.fn();
    renderSidebar({ user: managerUser, onToggleRail });
    fireEvent.click(screen.getByRole("button", { name: "Réduire la barre" }));
    expect(onToggleRail).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "[" });
    expect(onToggleRail).toHaveBeenCalledTimes(2);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "[" });
    expect(onToggleRail).toHaveBeenCalledTimes(2);
    input.remove();
  });
});

describe("Sidebar — the 64 px rail", () => {
  it("shows one button per group and opens its links beside the rail", () => {
    renderSidebar({ user: managerUser, rail: true });
    expect(screen.queryByText("Archivées")).not.toBeInTheDocument();
    const commandes = screen.getByRole("button", { name: "Commandes" });
    fireEvent.click(commandes);
    expect(commandes).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Archivées/ })).toHaveAttribute("href", "/fr/orders/archive");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("link", { name: /Archivées/ })).not.toBeInTheDocument();
  });

  it("keeps Dashboard one click away and grows back from its button", () => {
    const onToggleRail = vi.fn();
    renderSidebar({ user: managerUser, rail: true, onToggleRail });
    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Agrandir la barre" }));
    expect(onToggleRail).toHaveBeenCalled();
  });

  it("marks the group of the current page", () => {
    at("/fr/team/performance");
    renderSidebar({ user: managerUser, rail: true, currentPath: "/fr/team/performance" });
    expect(screen.getByRole("button", { name: "Performance" })).toHaveAttribute("data-current", "true");
  });
});

describe("Sidebar — phone", () => {
  it("puts a top bar over the page — menu, Ordra, market, alerts — instead of a floating button", () => {
    asPhone();
    const onMobileOpen = vi.fn();
    renderSidebar({ user: managerUser, onMobileOpen });
    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("Ordra")).toBeInTheDocument();
    expect(within(bar).getByLabelText("Marché actuel : Tunisie")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /Alertes/ })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Ouvrir le menu" }));
    expect(onMobileOpen).toHaveBeenCalled();
  });

  it("closes the drawer from its button, Escape, and any link", () => {
    asPhone();
    const onMobileClose = vi.fn();
    renderSidebar({ user: managerUser, mobileOpen: true, onMobileClose });
    fireEvent.click(screen.getByRole("button", { name: "Fermer le menu" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("link", { name: /Archivées/ }));
    expect(onMobileClose).toHaveBeenCalledTimes(3);
  });

  it("never shows the rail on a phone, even when chosen on the desktop", () => {
    asPhone();
    renderSidebar({ user: managerUser, rail: true, mobileOpen: true });
    expect(screen.getByRole("link", { name: /Archivées/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réduire la barre" })).not.toBeInTheDocument();
  });
});
