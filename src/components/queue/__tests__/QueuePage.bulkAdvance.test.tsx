"use client";

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { vi, describe, test, expect, beforeEach } from "vitest";

/**
 * Bulk "Terminer l'appel" walks the agent through several orders using ONE
 * PostCallActionSheet element. onSuccess (QueuePage.tsx) does
 *
 *     setCallTerminatedOrderId(null);      // unmount condition
 *     ...
 *     handleCallTerminated(next);          // remount condition, same tick
 *
 * React 18 batches both into a single commit, so the `callTerminatedOrderId &&`
 * guard never evaluates false and React reconciles rather than remounts. Every
 * useState inside the sheet — flow, rejectionReason/Subreason/Note,
 * selectedCarrierId — survives onto the next order, as does RejectionReasonSelect's
 * own group/sub/note state, which is seeded at mount only.
 *
 * The fix is `key={callTerminatedOrderId}`, matching OrderDetailPanel directly
 * above it. This test asserts the sheet MOUNTS once per order rather than being
 * reused, which is the only thing that clears the whole subtree.
 */

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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("../OrderDetailPanel", () => ({ OrderDetailPanel: () => null }));
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

describe("QueuePage bulk advance", () => {
  beforeEach(() => {
    mountedWith.length = 0;
  });

  test("advancing to the next order remounts the action sheet instead of reusing it", async () => {
    render(<QueuePage />);

    // Tick both rows, then start the bulk call flow.
    const checkboxes = await screen.findAllByRole("checkbox");
    const rowBoxes = checkboxes.filter(
      (c) => (c as HTMLInputElement).getAttribute("aria-label") !== "select-all",
    );
    await act(async () => {
      fireEvent.click(rowBoxes[0]);
      fireEvent.click(rowBoxes[1]);
    });

    const bulkBar = await screen.findByRole("region", { name: "Bulk actions" });
    const callEnded = Array.from(bulkBar.querySelectorAll("button")).find((b) =>
      /appel/i.test(b.textContent ?? ""),
    );
    expect(callEnded).toBeTruthy();
    await act(async () => {
      fireEvent.click(callEnded!);
    });
    // Let next/dynamic resolve the sheet chunk.
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("sheet")).toBeTruthy());
    expect(mountedWith).toEqual(["A"]);

    // Complete order A — QueuePage advances to B in the SAME commit.
    await act(async () => {
      fireEvent.click(screen.getByText("sheet-success"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("sheet").getAttribute("data-order")).toBe("B"),
    );

    // Without key={callTerminatedOrderId} this is ["A"] — the instance, and
    // every piece of rejection state inside it, is carried onto order B.
    expect(mountedWith).toEqual(["A", "B"]);
  });
});
