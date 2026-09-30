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
 * Clients › Messages — prototype `messages`: the crumb, the way to the
 * templates, both tab counts, and the list beside a ~460 px conversation.
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
  it("has the crumb, the title, and the switch to Modèles (reachable without a config)", () => {
    render(<MessagesPageClient user={user("market_manager", TN)} locale="fr" />);
    const top = screen.getByTestId("messages-header");
    expect(within(top).getByText("Clients › Messages")).toBeInTheDocument();
    expect(within(top).getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    expect(within(top).getByRole("link", { name: "Modèles" })).toHaveAttribute("href", "/fr/messages/templates");
    expect(within(top).getByRole("link", { name: "Conversations" })).toHaveAttribute("aria-current", "page");
  });

  it("shows both tab counts from the inbox", () => {
    render(<MessagesPageClient user={user("market_manager", TN)} locale="fr" />);
    expect(screen.getByRole("tab", { name: /À rattacher/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /Toutes/ })).toHaveTextContent("27");
  });

  it("lays the list beside a ~460 px conversation panel", () => {
    render(<MessagesPageClient user={user("market_manager", TN)} locale="fr" />);
    expect(screen.getByTestId("messages-grid").className).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_460px\]/);
  });

  it("explains a market that is not connected, and still shows the page", () => {
    availability.connected = false;
    render(<MessagesPageClient user={user("market_manager", TN)} locale="fr" />);
    expect(screen.getByText(/WhatsApp n'est pas connecté pour ce marché/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /À rattacher/ })).toBeInTheDocument();
  });

  it("a super_admin reads the market chosen in the sidebar", () => {
    scope.marketId = LY;
    render(<MessagesPageClient user={user("super_admin", null)} locale="fr" />);
    expect(inbox.args[0]).toBe(LY);
  });
});
