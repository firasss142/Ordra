"use client";

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { vi, describe, test, expect, beforeEach } from "vitest";

/**
 * The bell's « a répondu sur WhatsApp » deep-links to ?openOrderId=…&tab=messages.
 * The panel is keyed per order, so a tab kept in page state would open EVERY
 * order the agent clicks afterwards on Messages. The tab belongs to the
 * deep-linked order only.
 */
const panels: { orderId: string | null; initialTab?: string }[] = [];
const mountedWith: string[] = [];

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

let search = new URLSearchParams("openOrderId=A&tab=messages");
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/fr/queue",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// next/dynamic is left real: the modules it loads are mocked below, and the
// loader resolves on a microtask that the awaited act() calls flush.

// The sheet under scrutiny: records each MOUNT (not each render) and exposes a
// button that drives the real onSuccess path.
vi.mock("../PostCallActionSheet", () => {
  const React = require("react") as typeof import("react");
  return {
    PostCallActionSheet: ({
      orderId,
      onSuccess,
    }: {
      orderId: string;
      onSuccess: (r: { autoRejected?: boolean }) => void;
    }) => {
      React.useEffect(() => {
        mountedWith.push(orderId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <div data-testid="sheet" data-order={orderId}>
          <button onClick={() => onSuccess({})}>sheet-success</button>
        </div>
      );
    },
  };
});

vi.mock("../OrderDetailPanel", () => ({
  OrderDetailPanel: ({ orderId, initialTab }: { orderId: string | null; initialTab?: string }) => {
    panels.push({ orderId, initialTab });
    return null;
  },
}));
vi.mock("../ShortcutsOverlay", () => ({ ShortcutsOverlay: () => null }));
vi.mock("@/components/orders/CreateOrderModal", () => ({ CreateOrderModal: () => null }));

vi.mock("@/context/auth", () => ({
  useAuth: () => ({
    user: { id: "agent-1", market_id: "m1", role: "agent", full_name: "A" },
    loading: false,
  }),
}));

vi.mock("@/context/queue-search", () => ({
  useQueueSearch: () => ({
    query: "",
    setQuery: vi.fn(),
    setResultCount: vi.fn(),
    inputRef: { current: null },
  }),
}));

vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));

function rawOrder(id: string) {
  return {
    id,
    status: "pending",
    assigned_to: "agent-1",
    market_id: "m1",
    customer_name: `Cust ${id}`,
    customer_phone: "20000000",
    product_name: "P",
    quantity: 1,
    total_price: 10,
    attempts_count: 0,
    callback_scheduled_at: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    created_at: "2026-08-01T08:00:00Z",
    tracking_number: null,
    carrier_barcode_deleted_at: null,
  } as Record<string, unknown>;
}

const ORDERS = [rawOrder("A"), rawOrder("B")];

// QueuePage now also subscribes to order presence, which needs a
// <RealtimeProvider> this suite does not mount.
vi.mock("@/hooks/useOrderLocks", () => ({
  useOrderLocks: () => ({
    lockOf: () => null,
    presenceOf: () => [],
    othersOn: () => [],
    refresh: () => {},
  }),
}));

vi.mock("@/hooks/useAgentQueue", () => ({
  useAgentQueue: () => ({
    orders: ORDERS,
    allOrders: ORDERS,
    closedOrders: [],
    buckets: {
      nouveau: 2, tentative_1: 0, tentative_2: 0, tentative_3: 0,
      tentative_total: 0, rappel_prevu: 0, livraison_planifiee: 0,
      confirme: 0, rejete: 0, fermees: 0,
    },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
    connected: true,
    reassignmentEvent: null,
    acknowledgeReassignmentEvent: vi.fn(),
    tick: 0,
  }),
}));

// /api/agent/stats + /api/agent/settings — any truthy stats value gets us past
// the loading skeleton at QueuePage.tsx:728.
vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return {
    ...actual,
    default: (key: unknown) => {
      if (key === "/api/agent/stats") return { data: { data: { assigned: 2 } } };
      return { data: undefined };
    },
  };
});

import { QueuePage } from "../QueuePage";

describe("QueuePage — bell deep link to Messages", () => {
  test("opens the linked order on Messages, and the next order the agent picks on its default tab", async () => {
    render(<QueuePage />);
    await waitFor(() => expect(panels.some((p) => p.orderId === "A" && p.initialTab === "messages")).toBe(true));
    search = new URLSearchParams();

    await act(async () => {
      fireEvent.click(await screen.findByText("Cust B"));
    });
    await waitFor(() => expect(panels.at(-1)?.orderId).toBe("B"));
    expect(panels.at(-1)?.initialTab).toBeUndefined();
  });
});
