import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { QueueSearchProvider } from "@/context/queue-search";
import { AgentToastProvider } from "@/components/agent/shared";

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/fr/queue",
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params,
}));
vi.mock("@/context/auth", () => ({
  useAuth: () => ({ user: { id: "a1", full_name: "Salma Ben Ali", market_id: "00000000-0000-0000-0000-000000000002", role: "agent" } }),
}));
vi.mock("@/hooks/useOrderLocks", () => ({ useOrderLocks: () => ({ othersOn: () => [] }) }));
vi.mock("@/hooks/useSlaMinutes", () => ({ useSlaMinutes: () => 120 }));
vi.mock("@/hooks/useAgentMarketSearch", () => ({ useAgentMarketSearch: () => ({ rows: [], total: 0, pending: false, error: null }) }));
vi.mock("@/hooks/useRejectionBadge", () => ({ useRejectionBadge: () => () => null }));
vi.mock("@/components/feedback/FeedbackCaptureProvider", () => ({ useFeedbackCapture: () => ({ captureOpen: false }) }));
const panel = vi.fn();
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dyn(p: Record<string, unknown>) {
      if ("orderId" in p) {
        panel(p);
        return <aside data-testid="panel">{String(p.orderId)} {String(p.initialTray ?? "")}</aside>;
      }
      return null;
    },
}));

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const row = (o: Record<string, unknown>) => ({
  status: "pending", customer_name: "Client", customer_phone: "0911111111", customer_city: "Tripoli", product_name: "Tadabbur",
  quantity: 1, total_price: 210, currency: "LYD", attempts_count: 0, created_at: iso(30), ...o,
});
let queue: { allOrders: Record<string, unknown>[]; closedOrders: Record<string, unknown>[] };
const mutate = vi.fn();
vi.mock("@/hooks/useAgentQueue", () => ({
  useAgentQueue: () => ({
    orders: queue.allOrders, allOrders: queue.allOrders, closedOrders: queue.closedOrders,
    closedCounts: { all: 4, uploaded: 1, deposit: 2, delivered: 0, returned: 0, cancelled: 0, rejected: 1 },
    closedLoading: false, buckets: null, error: null, isLoading: false, mutate, connected: true,
    reassignmentEvent: null, acknowledgeReassignmentEvent: vi.fn(), tick: 0,
  }),
}));

import { AgentQueuePage } from "@/components/agent/queue/AgentQueuePage";

function renderPage() {
  const fetcher = (k: string) =>
    k === "/api/agent/stats" ? { assigned_today: 7, actioned_today: 12, confirmation_rate: 58 } : k === "/api/agent/settings" ? { max_call_attempts: 3 } : {};
  return render(
    <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <QueueSearchProvider>
          <AgentToastProvider>
            <AgentQueuePage />
          </AgentToastProvider>
        </QueueSearchProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("File de commandes", () => {
  beforeEach(() => {
    params = new URLSearchParams();
    panel.mockClear();
    queue = {
      allOrders: [
        row({ id: "n1", customer_name: "Ahmed Salem", created_at: iso(135) }),
        row({ id: "n2", customer_name: "Marwa T.", created_at: iso(20) }),
        row({ id: "t1", status: "attempt_1", attempts_count: 1, customer_name: "Omar Zawi", last_action_at: iso(60) }),
        row({ id: "c1", status: "callback_scheduled", attempts_count: 1, customer_name: "Sara Mabrouk", callback_scheduled_at: iso(47) }),
        row({ id: "k1", status: "confirmed", attempts_count: 1, customer_name: "Khaled Sharif", last_action_at: iso(8) }),
      ],
      closedOrders: [],
    };
  });

  it("says what the meters count — since midnight, and the file now", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("confirmées · aujourd'hui").previousSibling?.textContent).toBe("58%"));
    expect(screen.getByText("traitées · aujourd'hui")).toBeInTheDocument();
    expect(screen.getByText("dans votre file")).toBeInTheDocument();
  });

  it("draws one tile per bucket, and « En cours » turns red when a callback is due", () => {
    renderPage();
    const tiles = screen.getByRole("region", { name: "Votre file" });
    const buttons = within(tiles).getAllByRole("button");
    expect(buttons.map((b) => b.querySelector(".wt-t > span")?.textContent)).toEqual(["Nouveau", "En cours", "Confirmé", "Fermées"]);
    expect(buttons[0].textContent).toContain("2");
    expect(buttons[0].textContent).toContain("la plus ancienne attend depuis 2 h 15");
    expect(buttons[1].className).toContain("alarm");
    expect(buttons[1].textContent).toContain("1 rappel à faire maintenant");
    expect(buttons[2].textContent).toContain("à envoyer au transporteur");
  });

  it("lists Nouveau first, with « Pas encore appelé »", () => {
    renderPage();
    expect(screen.getByText("Ahmed Salem")).toBeInTheDocument();
    expect(screen.getAllByText("Pas encore appelé").length).toBe(2);
    expect(screen.queryByText("Omar Zawi")).toBeNull();
  });

  it("writes the callback time on the row, the due one first", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /En cours/ }));
    const rows = document.querySelectorAll(".row.qr");
    expect(rows[0].textContent).toContain("Sara Mabrouk");
    expect(rows[0].textContent).toMatch(/Rappel dû · \d\d:\d\d/);
    expect(rows[1].textContent).toContain("1/3");
  });

  it("names the carrier's chip in Fermées « Chez le transporteur »", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Fermées/ }));
    expect(screen.getByRole("tab", { name: /Chez le transporteur/ }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Actualiser le suivi/ })).toBeInTheDocument();
  });

  it("a confirmed row offers « Envoyer », which opens the order on the send step", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Confirmé/ }));
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(screen.getByTestId("panel").textContent).toBe("k1 send");
  });

  it("searches the whole file from the page field, across buckets", () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Rechercher nom, téléphone, ville, produit…"), { target: { value: "Omar" } });
    return waitFor(() => {
      expect(screen.getByText("Omar Zawi")).toBeInTheDocument();
      expect(screen.queryByText("Ahmed Salem")).toBeNull();
    });
  });

  it("opens the bell's order from ?openOrderId= and clears the link", () => {
    params = new URLSearchParams("openOrderId=t1");
    renderPage();
    expect(screen.getByTestId("panel").textContent).toContain("t1");
    expect(replace).toHaveBeenCalledWith("/fr/queue", { scroll: false });
  });

  it("« Démarrer les appels » opens the first ticked order, then the next after each ending", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Sélectionner la commande #n1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sélectionner la commande #n2/ }));
    fireEvent.click(screen.getByRole("button", { name: /Démarrer les appels/ }));
    expect(screen.getByTestId("panel").textContent).toContain("n1");
    const last = panel.mock.calls.at(-1)![0] as { onOutcomeDone: (r: object) => void };
    last.onOutcomeDone({ action: "attempt", newStatus: "attempt_1" });
    return waitFor(() => expect(screen.getByTestId("panel").textContent).toContain("n2"));
  });
});
