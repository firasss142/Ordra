import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("swr", () => ({ default: () => ({ data: undefined, mutate: vi.fn() }) }));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({ useWhatsAppTemplates: () => ({ templates: [], isLoading: false, mutate: vi.fn() }) }));
const scope = vi.hoisted(() => ({ marketId: null as string | null }));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: scope.marketId, scope: "all", marketCode: null, setScope: vi.fn() }) }));
const inbox = vi.hoisted(() => ({ args: [] as unknown[], counts: { orphans: 3, all: 27 } as { orphans: number; all: number } | null }));
vi.mock("@/hooks/useOrphanConversations", () => ({
  useOrphanConversations: (...args: unknown[]) => {
    inbox.args = args;
    return { conversations: [], counts: inbox.counts, isLoading: false, mutate: vi.fn() };
  },
}));
const availability = vi.hoisted(() => ({ connected: true as boolean | null }));
vi.mock("@/hooks/useWhatsAppAvailability", () => ({
  useWhatsAppAvailability: () => ({
    availability: availability.connected === null ? null : { connected: availability.connected },
    active: Boolean(availability.connected),
    isLoading: false,
  }),
}));

import { MessagesPageClient } from "../MessagesPageClient";

/**
 * Clients › Messages in Aurore calme — prototypes/voix-du-client-et-messages-v2.html
 * (page=messages): the crumb, the « Conversations · Modèles » switch with the
 * count of conversations to hand over, the dormant card while the number is
 * not connected (the real state on prod), the three-column inbox once it is.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const user = (role: "super_admin" | "market_manager", market_id: string | null) => ({
  id: "u",
  email: "x@oms.local",
  full_name: "X",
  avatar_url: null,
  role,
  market_id,
  locale: "fr" as const,
  direction: "ltr" as const,
});

beforeEach(() => {
  scope.marketId = null;
  inbox.counts = { orphans: 3, all: 27 };
  availability.connected = true;
});

describe("MessagesPageClient", () => {
  it("has the crumb, the title, the sub line and the switch to Modèles", () => {
    render(<MessagesPageClient user={user("market_manager", TN)} locale="fr" />);
    const top = screen.getByTestId("messages-header");
    expect(top.querySelector(".crumb")).toHaveTextContent("Clients/Messages");
    expect(within(top).getByRole("heading", { level: 1, name: "Messages" })).toBeInTheDocument();
    expect(within(top).getByText(/répondre, puis confier à la bonne commande/)).toBeInTheDocument();
    expect(within(top).getByRole("link", { name: "Modèles" })).toHaveAttribute("href", "/fr/messages/templates");
    const convs = within(top).getByRole("link", { name: /Conversations/ });
    expect(convs).toHaveAttribute("aria-current", "page");
    expect(convs).toHaveTextContent("3");
  });

  it("connected: the inbox with its three tabs and their counts", () => {
    render(<MessagesPageClient user={user("market_manager", TN)} locale="fr" />);
    expect(screen.getByRole("tab", { name: /À confier/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /Non lus/ })).toHaveTextContent("0");
    expect(screen.getByRole("tab", { name: /Toutes/ })).toHaveTextContent("27");
    expect(screen.queryByText("WhatsApp n'est pas encore connecté")).not.toBeInTheDocument();
  });

  it("not connected: the dormant card instead of the inbox; a manager is told only a super admin connects", () => {
    availability.connected = false;
    render(<MessagesPageClient user={user("market_manager", TN)} locale="fr" />);
    expect(screen.getByRole("heading", { name: "WhatsApp n'est pas encore connecté" })).toBeInTheDocument();
    expect(screen.getByText("Ce que cette page fera")).toBeInTheDocument();
    expect(screen.getByText("Les clients écrivent")).toBeInTheDocument();
    expect(screen.getByText("Pour connecter")).toBeInTheDocument();
    expect(screen.getByText("Compte Meta Business vérifié")).toBeInTheDocument();
    expect(screen.getByText("Seul un super admin peut relier le numéro.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ouvrir Connexions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /À confier/ })).not.toBeInTheDocument();
    // No count on the switch while nothing can arrive.
    expect(within(screen.getByTestId("messages-header")).getByRole("link", { name: "Conversations" })).toBeInTheDocument();
  });

  it("not connected: a super_admin gets « Ouvrir Connexions » to the WhatsApp settings", () => {
    availability.connected = false;
    scope.marketId = LY;
    render(<MessagesPageClient user={user("super_admin", null)} locale="fr" />);
    expect(screen.getByRole("link", { name: /Ouvrir Connexions/ })).toHaveAttribute("href", "/fr/system/settings/whatsapp");
  });

  it("a super_admin reads the market chosen in the sidebar, every conversation at once", () => {
    scope.marketId = LY;
    render(<MessagesPageClient user={user("super_admin", null)} locale="fr" />);
    expect(inbox.args[0]).toBe(LY);
    expect(inbox.args[1]).toBe("all");
  });

  it("a super_admin on « all markets » is asked to pick one", () => {
    render(<MessagesPageClient user={user("super_admin", null)} locale="fr" />);
    expect(screen.getByText("Choisissez un marché pour voir ses conversations.")).toBeInTheDocument();
  });
});
