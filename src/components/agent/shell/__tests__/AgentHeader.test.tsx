import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { AgentHeader } from "@/components/agent/shell/AgentHeader";
import { QueueSearchProvider } from "@/context/queue-search";
import { AgentToastProvider } from "@/components/agent/shared";
import type { AuthUser } from "@/types";

let path = "/fr/queue";
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
}));
vi.mock("swr", async (orig) => ({ ...(await orig<typeof import("swr")>()), preload: vi.fn() }));
vi.mock("@/components/providers/RealtimeProvider", () => ({
  useRealtimeSubscribe: () => {},
  useBroadcastConnected: () => true,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }),
}));

const user = {
  id: "a1", email: "salma@ordra.ly", full_name: "Salma Ben Ali", avatar_url: null, role: "agent",
  market_id: "00000000-0000-0000-0000-000000000002", locale: "fr", direction: "ltr",
} as AuthUser;

function renderHeader(data: Record<string, unknown> = {}) {
  const fetcher = (key: string) => {
    if (key in data) return data[key];
    if (key === "/api/agent/availability") return { data: { is_available: true, receiving_orders: true } };
    return { data: [], rows: [] };
  };
  return render(
    <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr}>
        <QueueSearchProvider>
          <AgentToastProvider>
            <AgentHeader user={user} />
          </AgentToastProvider>
        </QueueSearchProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("AgentHeader — one glass band: the word, the five tabs, then search · availability · bell · me", () => {
  beforeEach(() => {
    path = "/fr/queue";
  });

  it("says Ordra and the market", () => {
    renderHeader();
    expect(screen.getByText("Ordra")).toBeInTheDocument();
    expect(screen.getByText("Libye")).toBeInTheDocument();
  });

  it("has the five tabs in the prototype's order, the current one marked", () => {
    renderHeader();
    const nav = screen.getByRole("navigation", { name: "Navigation" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent?.trim())).toEqual(["Commandes", "CRM", "Livraison", "Mes commissions", "Voix du client"]);
    expect(links[0].getAttribute("aria-current")).toBe("page");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/fr/queue", "/fr/leads", "/fr/delivery", "/fr/commissions", "/fr/feedback"]);
  });

  it("shows no header search on Commandes — the queue has its own field, bound to the same query", () => {
    renderHeader();
    expect(screen.queryByPlaceholderText("Rechercher dans le marché…")).toBeNull();
  });

  it("shows the market search on the other tabs", () => {
    path = "/fr/delivery";
    renderHeader();
    expect(screen.getByPlaceholderText("Rechercher dans le marché…")).toBeInTheDocument();
  });

  it("the Livraison tab counts parcels to act on now plus returns to save", async () => {
    renderHeader({ "/api/delivery/worklist": { rows: [{ bucket: "act_now" }, { bucket: "returning" }, { bucket: "done" }] } });
    await waitFor(() => expect(screen.getByRole("link", { name: /Livraison/ }).textContent).toContain("2"));
  });

  it("is a real switch for « Disponible »", async () => {
    renderHeader();
    const sw = await screen.findByRole("switch", { name: "Je prends des commandes" });
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(sw.textContent).toContain("Disponible");
  });

  it("opens the me-menu with the e-mail, the photo and the logout", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /Salma/ }));
    expect(screen.getByText("salma@ordra.ly")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Changer la photo" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Déconnexion" })).toBeInTheDocument();
  });

  it("opens the bell with the unread count and « Tout marquer comme lu »", async () => {
    renderHeader({
      "/api/notifications": {
        data: [
          { id: "n1", order_id: "o1", kind: "callback_due", due_at: new Date(Date.now() - 47 * 60000).toISOString(), read_at: null, created_at: new Date(Date.now() - 3600000).toISOString(), order: { customer_name: "Ahmed Salem", product_name: "Tadabbur", variant_label: null } },
        ],
      },
    });
    const bell = screen.getByRole("button", { name: "Notifications" });
    await waitFor(() => expect(bell.textContent).toContain("1"));
    fireEvent.click(bell);
    expect(screen.getByText("Notifications (1)")).toBeInTheDocument();
    expect(screen.getByText("Ahmed Salem")).toBeInTheDocument();
    expect(screen.getByText(/Rappel en attente/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tout marquer comme lu" })).toBeInTheDocument();
  });
});
