"use client";

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { vi, describe, test, expect, beforeEach } from "vitest";

/**
 * The panel's four endings open the call sheet. The panel used to close the
 * moment one was tapped, so on a phone — where the panel IS the screen — a
 * « Rejeter » tapped by mistake, then « Annuler », dropped the agent back on
 * the list with the order gone. The order stays open under the sheet now, and
 * closes only once an outcome is actually recorded.
 */

const panel: { orderId: string | null; covered?: boolean } = { orderId: null };
const sheet: { orderId: string | null; initialFlow?: string } = { orderId: null };

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/fr/queue",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../PostCallActionSheet", () => ({
  PostCallActionSheet: ({
    orderId,
    initialFlow,
    onClose,
    onSuccess,
  }: {
    orderId: string;
    initialFlow?: string;
    onClose: () => void;
    onSuccess: (r: { action: string; newStatus: string }) => void;
  }) => {
    sheet.orderId = orderId;
    sheet.initialFlow = initialFlow;
    return (
      <div data-testid="sheet">
        <button onClick={onClose}>sheet-cancel</button>
        <button onClick={() => onSuccess({ action: "rejected", newStatus: "rejected" })}>
          sheet-success
        </button>
      </div>
    );
  },
}));

vi.mock("../OrderDetailPanel", () => ({
  OrderDetailPanel: ({
    orderId,
    covered,
    onCallTerminated,
  }: {
    orderId: string | null;
    covered?: boolean;
    onCallTerminated: (id: string, ctx: Record<string, unknown>) => void;
  }) => {
    panel.orderId = orderId;
    panel.covered = covered;
    if (!orderId) return null;
    return (
      <button
        onClick={() =>
          onCallTerminated(orderId, {
            orderId,
            status: "pending",
            marketId: "m1",
            attemptsCount: 0,
            flow: "reject_flow",
          })
        }
      >
        panel-reject
      </button>
    );
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

const ORDERS = [
  {
    id: "A",
    status: "pending",
    assigned_to: "agent-1",
    market_id: "m1",
    customer_name: "Cust A",
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
  } as Record<string, unknown>,
];

vi.mock("@/hooks/useOrderLocks", () => ({
  useOrderLocks: () => ({ lockOf: () => null, presenceOf: () => [], othersOn: () => [], refresh: () => {} }),
}));

vi.mock("@/hooks/useAgentQueue", () => ({
  useAgentQueue: () => ({
    orders: ORDERS,
    allOrders: ORDERS,
    closedOrders: [],
    buckets: {
      nouveau: 1, tentative_1: 0, tentative_2: 0, tentative_3: 0,
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

vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return {
    ...actual,
    default: (key: unknown) => {
      if (key === "/api/agent/stats") return { data: { data: { assigned: 1 } } };
      return { data: undefined };
    },
  };
});

import { QueuePage } from "../QueuePage";

async function openOrderThenReject() {
  render(<QueuePage />);
  await act(async () => {
    fireEvent.click(await screen.findByText("Cust A"));
  });
  await act(async () => {
    fireEvent.click(await screen.findByText("panel-reject"));
  });
  await screen.findByTestId("sheet");
}

beforeEach(() => {
  panel.orderId = null;
  panel.covered = undefined;
  sheet.orderId = null;
  sheet.initialFlow = undefined;
});

describe("QueuePage — the order stays open under the call sheet", () => {
  test("opens the sheet on the ending the panel named, with the order still open beneath", async () => {
    await openOrderThenReject();
    expect(sheet.orderId).toBe("A");
    expect(sheet.initialFlow).toBe("reject_flow");
    expect(panel.orderId).toBe("A");
  });

  test("« Annuler » on the sheet goes back to the order, not to the list", async () => {
    await openOrderThenReject();
    await act(async () => {
      fireEvent.click(screen.getByText("sheet-cancel"));
    });
    expect(screen.queryByTestId("sheet")).toBeNull();
    expect(panel.orderId).toBe("A");
  });

  test("tells the panel it is covered while the sheet is up, so one Escape closes only the sheet", async () => {
    await openOrderThenReject();
    expect(panel.covered).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText("sheet-cancel"));
    });
    expect(panel.covered).toBe(false);
  });

  test("closes the order once the outcome is recorded", async () => {
    await openOrderThenReject();
    await act(async () => {
      fireEvent.click(screen.getByText("sheet-success"));
    });
    await waitFor(() => expect(panel.orderId).toBeNull());
  });
});

// Voix du client — the capture window owns its keys; the queue's Enter must not end a call
// underneath it.
const capture = vi.hoisted(() => ({ open: false }));
vi.mock("@/components/feedback/FeedbackCaptureProvider", () => ({
  useFeedbackCapture: () => ({ enabled: true, captureOpen: capture.open, openCapture: () => {}, register: () => () => {} }),
}));
vi.mock("@/hooks/useFeedback", () => ({ useOpenComplaints: () => ({}) }));

describe("QueuePage — stands down under the capture window", () => {
  test("Enter on the focused row does nothing while the window is open", async () => {
    capture.open = true;
    render(<QueuePage />);
    await screen.findByText("Cust A");
    await act(async () => { fireEvent.keyDown(document.body, { key: "Enter" }); });
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  test("and ends the call as usual once it is closed", async () => {
    capture.open = false;
    render(<QueuePage />);
    await screen.findByText("Cust A");
    await act(async () => { fireEvent.keyDown(document.body, { key: "Enter" }); });
    expect(await screen.findByTestId("sheet")).toBeInTheDocument();
  });
});
