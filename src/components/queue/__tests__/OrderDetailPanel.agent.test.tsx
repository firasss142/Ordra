import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useSWR from "swr";
import { OrderDetailPanel } from "../OrderDetailPanel";
import { LY_MARKET_ID } from "@/lib/markets";

vi.mock("next/dynamic", () => ({
  default: () => function DynamicStub() {
    return null;
  },
}));

vi.mock("swr", () => ({
  default: vi.fn(),
  useSWRConfig: () => ({ mutate: vi.fn(), cache: new Map() }),
}));

vi.mock("@/hooks/useOrderMutation", async () => {
  // OrderConflictError is a real class the panel branches on with
  // `instanceof`, so the mock must expose the real one, not a stub.
  const actual = await vi.importActual<typeof import("@/hooks/useOrderMutation")>(
    "@/hooks/useOrderMutation",
  );
  return {
    OrderConflictError: actual.OrderConflictError,
    useOrderMutation: () => ({
      commit: vi.fn(),
      patchItemOptimistic: vi.fn(),
      deleteItemOptimistic: vi.fn(),
      // Seeds the save precondition from the loaded order.
      noteServerRow: vi.fn(),
    }),
  };
});

// Sibling realtime hooks: both need a <RealtimeProvider> this suite does not
// mount. Stubbed together so adding one to the panel cannot break the suite in
// isolation again — see docs/orders-page-performance.md §7.
vi.mock("@/hooks/useOrderLocks", () => ({
  useOrderLocks: () => ({
    lockOf: () => null,
    presenceOf: () => [],
    othersOn: () => [],
    refresh: () => {},
  }),
}));

vi.mock("@/hooks/useOrderPresence", () => ({
  useOrderPresence: () => ({ blockingAgent: null, sessionId: "test-session" }),
}));

vi.mock("@/hooks/useOrderDetailRealtime", () => ({
  useOrderDetailRealtime: () => {},
}));

// The WhatsApp thread subscribes to realtime too; the availability and
// templates hooks read SWR keys this suite does not stub. Inert here — the
// Messages tab has its own suites (components/whatsapp).
let waAvailability: { availability: null; active: boolean; known: boolean; isLoading: boolean } = { availability: null, active: false, known: false, isLoading: false };
let waThread: Record<string, unknown> | null = null;
vi.mock("@/hooks/useWhatsAppThread", () => ({
  useWhatsAppThread: () => ({ thread: waThread, unread: 0, isLoading: false, error: null, mutate: vi.fn(), markRead: vi.fn(), retry: vi.fn() }),
}));
vi.mock("@/hooks/useWhatsAppAvailability", () => ({
  useWhatsAppAvailability: () => waAvailability,
}));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({
  useWhatsAppTemplates: () => ({ templates: [], isLoading: false, mutate: vi.fn() }),
}));

// Spy on DexpressStatusSection so we can assert its mount + props without
// pulling in the SWR fetcher chain it owns.
const dexpressSectionSpy = vi.fn();
vi.mock("../DexpressStatusSection", () => ({
  DexpressStatusSection: (props: unknown) => {
    dexpressSectionSpy(props);
    return null;
  },
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const arMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => {
      const t = (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(arMessages, ns, key, params);
      // The status pill asks whether a status has a label before using it.
      t.has = (key: string) => resolveTranslation(arMessages, ns, key) !== key;
      return t;
    },
    useLocale: () => "fr",
  };
});

const order = {
  id: "order-1",
  customer_name: "Ali",
  customer_phone: "0912345678",
  customer_phone_2: null,
  customer_city: "Tripoli",
  customer_address: "Main street",
  customer_note: null,
  product_id: "product-1",
  product_name: "Product",
  variant_id: null,
  variant_label: null,
  city_id: null,
  dexpress_state_id: 1,
  quantity: 1,
  unit_price: 10,
  total_price: 20,
  delivery_fee: 10,
  card_payment: false,
  currency: "TND",
  status: "pending",
  assigned_to: "user-1",
  market_id: LY_MARKET_ID,
  attempts_count: 0,
  updated_at: "2026-05-01T10:00:00Z",
  tracking_number: null,
  carrier_id: null,
  carrier_barcode_deleted_at: null,
  carrier_barcode_deleted_carrier_code: null,
  callback_scheduled_at: null,
  scheduled_dispatch_at: null,
  scheduled_dispatch_auto: null,
  scheduled_dispatch_carrier_id: null,
  history: [],
  order_items: [],
};


vi.mock("@/hooks/useMaxCallAttempts", () => ({ useMaxCallAttempts: () => 3 }));
vi.mock("@/hooks/useSlaMinutes", () => ({ useSlaMinutes: () => 120 }));

const REASONS = [
  { id: "g1", market_id: LY_MARKET_ID, key: "refus_client", parent_key: null, label_fr: "Refus client", label_ar: "x", short_fr: "x", short_ar: "x", sort_order: 1, is_active: true, requires_note: false },
  { id: "s1", market_id: LY_MARKET_ID, key: "prix_eleve", parent_key: "refus_client", label_fr: "Prix trop élevé", label_ar: "x", short_fr: "x", short_ar: "x", sort_order: 1, is_active: true, requires_note: false },
];

let currentOrder: Record<string, unknown> = order;
let posts: string[] = [];

function swrFor(key: unknown) {
  const base = { error: undefined, isLoading: false, isValidating: false, mutate: vi.fn() };
  if (key === "/api/orders/order-1") return { ...base, data: { data: currentOrder } };
  if (typeof key === "string" && key.startsWith("/api/settings/rejection-reasons")) return { ...base, data: { data: REASONS } };
  if (typeof key === "string" && key.startsWith("/api/carriers?")) return { ...base, data: { data: [{ id: "c-1", name: "Vanex", code: "vanex", is_active: true }] } };
  return { ...base, data: undefined };
}

const agentPanel = (extra: Record<string, unknown> = {}) => {
  const onClose = vi.fn();
  const onOutcomeDone = vi.fn();
  render(<div className="agt"><OrderDetailPanel orderId="order-1" variant="side" role="agent" userId="user-1" onClose={onClose} onOutcomeDone={onOutcomeDone} {...extra} /></div>);
  return { onClose, onOutcomeDone };
};

describe("OrderDetailPanel — the agent's four endings (agent-shell-v2)", () => {
  beforeEach(() => {
    currentOrder = { ...order, status: "attempt_1", attempts_count: 1, created_at: new Date(Date.now() - 30 * 60_000).toISOString() };
    posts = [];
    vi.mocked(useSWR).mockImplementation(((key: unknown) => swrFor(key)) as unknown as typeof useSWR);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push(url);
      const body = url.endsWith("/no-answer") ? { data: { new_status: "attempt_2", auto_rejected: false, attempts_count: 2 } } : { data: {} };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reads « Tentative 1/3 », runs the SLA clock, and names the four endings with their keys", () => {
    agentPanel();
    expect(screen.getByText("Tentative 1/3")).toBeInTheDocument();
    expect(screen.getByTestId("panel-sla")).toHaveClass("run");
    const foot = screen.getByTestId("panel-actions");
    for (const [k, w] of [["1", "Pas de réponse"], ["2", "Confirmer"], ["3", "Refuser"], ["4", "Rappeler"]]) {
      expect(foot).toHaveTextContent(`${k}${w}`);
    }
    // The keys sit on the buttons; the full list is the queue's « ? » (no hint row under them).
    expect(document.querySelector(".keys")).toBeNull();
  });

  it("opens the rejection INSIDE the order on key 3 — no dialog — and Escape closes the step, then the order", () => {
    const { onClose } = agentPanel();
    fireEvent.keyDown(document, { key: "3" });
    expect(document.querySelector(".tray")).toHaveTextContent("Pourquoi ?");
    expect(screen.queryByTestId("panel-actions")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".tray")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("records « Pas de réponse » on key 1, says so in the result line and tells the page", async () => {
    const { onOutcomeDone } = agentPanel();
    fireEvent.keyDown(document, { key: "1" });
    await waitFor(() => expect(onOutcomeDone).toHaveBeenCalledWith({ action: "attempt", newStatus: "attempt_2", autoRejected: false }));
    expect(posts).toEqual(["/api/orders/order-1/no-answer"]);
    expect(screen.getByTestId("outcome-done")).toHaveTextContent("Tentative 2/3 enregistrée");
  });

  it("ignores the keys while typing in a field", () => {
    agentPanel();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "3" });
    expect(document.querySelector(".tray")).toBeNull();
    input.remove();
  });

  it("opens straight on the send step when the queue row's truck asked for it", () => {
    currentOrder = { ...order, status: "confirmed" };
    agentPanel({ initialTray: "send" });
    expect(document.querySelector(".tray")).toHaveTextContent("Choisir le transporteur");
  });

  it("offers « Envoyer au transporteur » and « Planifier la livraison » on a confirmed order", () => {
    currentOrder = { ...order, status: "confirmed" };
    agentPanel();
    const foot = screen.getByTestId("panel-actions");
    expect(foot).toHaveTextContent("Envoyer au transporteur");
    expect(foot).toHaveTextContent("Planifier la livraison");
    fireEvent.click(screen.getByRole("button", { name: /Planifier la livraison/ }));
    expect(document.querySelector(".tray")).toHaveTextContent("Programmer la livraison");
  });

  it("closes a closed order with « Fermer »", () => {
    currentOrder = { ...order, status: "delivered" };
    const { onClose } = agentPanel();
    fireEvent.click(within(screen.getByTestId("panel-actions")).getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("OrderDetailPanel — the manager's call results use the same steps, inside the order", () => {
  const managerPanel = () => {
    const onClose = vi.fn();
    const onOutcomeDone = vi.fn();
    render(<OrderDetailPanel orderId="order-1" role="market_manager" userId="mgr-1" onClose={onClose} onOutcomeDone={onOutcomeDone} />);
    return { onClose, onOutcomeDone };
  };
  beforeEach(() => {
    currentOrder = { ...order, status: "attempt_1", attempts_count: 1, created_at: new Date(Date.now() - 30 * 60_000).toISOString() };
    posts = [];
    vi.mocked(useSWR).mockImplementation(((key: unknown) => swrFor(key)) as unknown as typeof useSWR);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push(url);
      const body = url.endsWith("/no-answer") ? { data: { new_status: "attempt_2", auto_rejected: false, attempts_count: 2 } } : { data: {} };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("opens « Refuser » as the reasons step inside the order, never the old call sheet", () => {
    managerPanel();
    fireEvent.click(within(screen.getByTestId("panel-actions")).getByRole("button", { name: "Refuser" }));
    expect(document.querySelector(".tray")).toHaveTextContent("Pourquoi ?");
    expect(screen.queryByTestId("panel-actions")).toBeNull();
    expect(screen.queryByText("Résultat de l'appel")).toBeNull();
  });

  it("Escape closes the step before the order", () => {
    const { onClose } = managerPanel();
    fireEvent.click(within(screen.getByTestId("panel-actions")).getByRole("button", { name: "Rappeler" }));
    expect(document.querySelector(".tray")).toHaveTextContent("Programmer un rappel");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".tray")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("records « Pas de réponse » straight away and tells the page", async () => {
    const { onOutcomeDone } = managerPanel();
    fireEvent.click(within(screen.getByTestId("panel-actions")).getByRole("button", { name: "Pas de réponse" }));
    await waitFor(() => expect(onOutcomeDone).toHaveBeenCalledWith({ action: "attempt", newStatus: "attempt_2", autoRejected: false }));
    expect(posts).toEqual(["/api/orders/order-1/no-answer"]);
  });

  it("confirms, then opens the send step with « Commande confirmée avec succès. »", async () => {
    managerPanel();
    fireEvent.click(within(screen.getByTestId("panel-actions")).getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(document.querySelector(".tray")).toHaveTextContent("Choisir le transporteur"));
    expect(posts).toEqual(["/api/orders/order-1/confirm"]);
  });
});

