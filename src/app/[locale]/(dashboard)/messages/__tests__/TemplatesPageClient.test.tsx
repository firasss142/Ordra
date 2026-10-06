import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import frMessages from "@/messages/fr.json";

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

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
const scope = vi.hoisted(() => ({ marketId: null as string | null }));
vi.mock("@/hooks/useOrphanConversations", () => ({
  useOrphanConversations: () => ({ conversations: [], counts: { orphans: 4, all: 9 }, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: scope.marketId, scope: "all", marketCode: null, setScope: vi.fn() }) }));

import { ToastProvider } from "@/components/ui/Toast";
import { TemplatesPageClient } from "../templates/TemplatesPageClient";

/**
 * Clients › Messages › Modèles. Reachable without a config (the owner's
 * decision: WhatsApp surfaces stay visible and explain themselves), with the
 * prototype's top bar: crumb, title, sync + create, and the way back to the
 * conversations.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const MARKETS = [
  { id: TN, name: "Tunisie", code: "tn" },
  { id: LY, name: "Libye", code: "ly" },
];
const user = (role: "super_admin" | "market_manager") => ({
  id: "u",
  email: "x@oms.local",
  full_name: "X",
  avatar_url: null,
  role,
  market_id: role === "super_admin" ? null : TN,
  locale: "fr" as const,
  direction: "ltr" as const,
});

let connected = true;
beforeEach(() => {
  vi.clearAllMocks();
  scope.marketId = null;
  connected = true;
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string | null) => {
    if (key?.startsWith("/api/whatsapp/availability")) {
      return { data: { data: { market_id: TN, connected, active: connected, status: null, display_phone: null, verified_name: null, messaging_limit_tier: null, quality_rating: null } }, isLoading: false };
    }
    if (key?.startsWith("/api/whatsapp/templates")) return { data: { data: [] }, isLoading: false, mutate: vi.fn() };
    return { data: undefined };
  });
});

function mount(role: "super_admin" | "market_manager", markets = MARKETS) {
  return render(
    <ToastProvider>
      <TemplatesPageClient user={user(role)} markets={markets} initialMarketId={TN} locale="fr" />
    </ToastProvider>,
  );
}

describe("TemplatesPageClient", () => {
  it("has the Messages header with Modèles active, and the templates card with sync", () => {
    mount("super_admin");
    const top = screen.getByTestId("messages-header");
    expect(top.querySelector(".crumb")).toHaveTextContent("Clients/Messages");
    expect(within(top).getByRole("heading", { level: 1, name: "Messages" })).toBeInTheDocument();
    expect(within(top).getByRole("link", { name: /Conversations/ })).toHaveAttribute("href", "/fr/messages");
    expect(within(top).getByRole("link", { name: /Conversations/ })).toHaveTextContent("4");
    expect(within(top).getByRole("link", { name: "Modèles" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Synchroniser avec Meta/ })).toBeInTheDocument();
  });

  it("a super_admin not connected is sent to Connexions › Services", () => {
    connected = false;
    mount("super_admin");
    expect(screen.getByRole("link", { name: "Ouvrir Réglages › WhatsApp" })).toHaveAttribute("href", "/fr/system/settings/whatsapp");
  });

  it("a market_manager reads: no link to connect, no event select", () => {
    connected = false;
    mount("market_manager", [MARKETS[0]]);
    expect(screen.queryByRole("link", { name: "Ouvrir Réglages › WhatsApp" })).not.toBeInTheDocument();
    expect(screen.getByText(/ces modèles seront soumis à Meta/)).toBeInTheDocument();
  });

  it("opens on the market chosen in the sidebar for a super_admin", () => {
    scope.marketId = LY;
    mount("super_admin");
    expect(useSWR).toHaveBeenCalledWith(`/api/whatsapp/templates?market_id=${LY}`, expect.anything(), expect.anything());
    expect(within(screen.getByRole("group", { name: "Marché" })).getByRole("button", { name: /Libye/ })).toHaveAttribute("aria-pressed", "true");
  });
});
