import { fireEvent, render, screen } from "@testing-library/react";
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
  const arMessages = (await import("@/messages/ar.json")).default;
  return {
    useTranslations: (ns: string) => {
      const t = (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(arMessages, ns, key, params);
      // The status pill asks whether a status has a label before using it.
      t.has = (key: string) => resolveTranslation(arMessages, ns, key) !== key;
      return t;
    },
    useLocale: () => "ar",
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

let currentOrder: Record<string, unknown> = order;
let currentCarriers: Array<{ id: string; name: string; code: string; is_active: boolean }> = [];

describe("OrderDetailPanel", () => {
  beforeEach(() => {
    currentOrder = order;
    currentCarriers = [];
    dexpressSectionSpy.mockClear();
    const swrBase = {
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    };

    vi.mocked(useSWR).mockImplementation((key) => {
      if (key === "/api/orders/order-1") {
        return {
          ...swrBase,
          data: { data: currentOrder },
        } as unknown as ReturnType<typeof useSWR>;
      }

      if (typeof key === "string" && key.startsWith("/api/carriers")) {
        return {
          ...swrBase,
          data: { data: currentCarriers },
        } as unknown as ReturnType<typeof useSWR>;
      }

      return {
        ...swrBase,
        data: undefined,
      } as unknown as ReturnType<typeof useSWR>;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    waAvailability = { availability: null, active: false, known: false, isLoading: false };
    waThread = null;
  });

  // Owner decision 2026-09-25: a market without a connected number shows
  // WhatsApp DISABLED, not hidden (prototype whatsapp-agent-v1.html, state
  // `noconfig`, with the wa.me link as the way out).
  it("market not connected: the WhatsApp button and the Messages tab are there, and the tab explains why with the wa.me link", () => {
    waAvailability = { availability: null, active: false, known: true, isLoading: false };
    waThread = { conversation: null, messages: [], phone_e164: "218912345678", customer_language: null, window_open: false, window_closes_at: null, config_active: false, config_status: null };
    render(<OrderDetailPanel orderId="order-1" onClose={() => {}} onCallTerminated={() => {}} userId="user-1" />);

    const btn = screen.getByRole("button", { name: /^واتساب/ });
    expect(btn).toHaveAttribute("data-state", "not_connected");
    fireEvent.click(btn);
    expect(screen.getByRole("tab", { name: /الرسائل/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("واتساب غير موصول لهذا السوق")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /فتح واتساب/ })).toHaveAttribute("href", "https://wa.me/218912345678");
  });

  it("does not render a Google Maps link and shows Libya display currency", () => {
    const { container } = render(
      <OrderDetailPanel
        orderId="order-1"
        onClose={() => {}}
        onCallTerminated={() => {}}
        userId="user-1"
      />,
    );

    expect(screen.getAllByText("Tripoli").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/LBY/).length).toBeGreaterThan(0);
    expect(container.querySelector('a[href*="google.com/maps"]')).toBeNull();
  });

  it("edits the primary phone from the phone strip without duplicating the number", () => {
    render(
      <OrderDetailPanel
        orderId="order-1"
        onClose={() => {}}
        onCallTerminated={() => {}}
        userId="user-1"
      />,
    );

    expect(screen.getAllByText(order.customer_phone)).toHaveLength(1);

    fireEvent.click(screen.getByText(order.customer_phone));

    const phoneInput = screen.getByRole("textbox") as HTMLInputElement;
    expect(phoneInput.type).toBe("tel");
    expect(phoneInput.value).toBe(order.customer_phone);
  });

  it("shows the whole receipt on the Articles tab, with nothing left to expand", () => {
    render(
      <OrderDetailPanel
        orderId="order-1"
        onClose={() => {}}
        onCallTerminated={() => {}}
        userId="user-1"
      />,
    );

    // The tab is the disclosure. A card inside it that also collapsed meant
    // opening a panel to check a receipt, then clicking again to see it.
    expect(screen.queryByTestId("order-details-toggle")).toBeNull();

    expect(screen.getAllByText("Product").length).toBeGreaterThan(0);
    // The breakdown is present immediately, not behind a toggle.
    expect(screen.getByText("رسوم التوصيل")).toBeTruthy();
    expect(screen.getByTestId("items-grand-total").textContent).toContain("20.00");
  });

  it("shows one tab's content at a time", () => {
    // `hidden` as an attribute loses to any author `display` rule — a panel
    // classed `flex` stayed on screen while marked hidden, so the delivery
    // rows rendered underneath the receipt and the log below both.
    render(
      <OrderDetailPanel
        orderId="order-1"
        onClose={() => {}}
        onCallTerminated={() => {}}
        userId="user-1"
      />,
    );

    // On Articles: the receipt is on screen, the delivery rows are not.
    expect(screen.getByTestId("items-grand-total")).toBeVisible();
    expect(screen.getByText("لم يصل بعد إلى شركة التوصيل")).not.toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: /livraison|التوصيل/i }));

    expect(screen.getByText("لم يصل بعد إلى شركة التوصيل")).toBeVisible();
    expect(screen.getByTestId("items-grand-total")).not.toBeVisible();
  });

  it("keeps the log out of reach until you open its tab", () => {
    currentOrder = {
      ...order,
      history: [
        {
          id: "history-1",
          from_status: null,
          to_status: "pending",
          note: "Order received via webhook",
          actor_id: null,
          actor_type: "system",
          created_at: "2026-05-01T10:00:00Z",
        },
      ],
    };

    render(
      <OrderDetailPanel
        orderId="order-1"
        onClose={() => {}}
        onCallTerminated={() => {}}
        userId="user-1"
      />,
    );

    // Inactive tabs are `hidden`, so their content is out of the accessibility
    // tree entirely — the log is neither visible nor reachable until selected.
    expect(screen.queryByRole("list")).toBeNull();

    const historyTab = screen.getByRole("tab", { name: /historique|السجل/i });
    expect(historyTab.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(historyTab);

    // Selecting the tab is the whole gesture — the log is not then folded
    // inside a second collapse.
    expect(screen.queryByTestId("order-history-toggle")).toBeNull();
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getAllByText("قيد الانتظار").length).toBeGreaterThan(0);
    expect(screen.getByText("تم استلام الطلب من تكامل المتجر")).toBeTruthy();
    expect(screen.queryByText("pending")).toBeNull();
  });

  describe("the prototype's layout (commandes-v4)", () => {
    it("is the drawer over a scrim on the orders page, under the .cmd token root", () => {
      render(<OrderDetailPanel orderId="order-1" onClose={() => {}} onCallTerminated={() => {}} userId="user-1" />);
      const drawer = screen.getByRole("dialog");
      expect(drawer).toHaveClass("drawer");
      expect(drawer.closest(".cmd")).not.toBeNull();
      expect(document.querySelector(".cmd > .scrim")).not.toBeNull();
    });

    it("closes from the scrim", () => {
      const onClose = vi.fn();
      render(<OrderDetailPanel orderId="order-1" onClose={onClose} onCallTerminated={() => {}} userId="user-1" />);
      fireEvent.click(document.querySelector(".scrim")!);
      expect(onClose).toHaveBeenCalled();
    });

    it("pins a missing city as a notice directly above the footer", () => {
      currentOrder = { ...order, customer_city: null };
      render(<OrderDetailPanel orderId="order-1" onClose={() => {}} onCallTerminated={() => {}} userId="user-1" />);
      const note = screen.getByText("المدينة غير محددة — يجب تحديدها قبل الإرسال").closest(".notes")!;
      expect(note.nextElementSibling).toHaveClass("dr-foot");
    });

    it("reads the customer's record from the list row when it carries one", () => {
      render(
        <OrderDetailPanel
          orderId="order-1"
          onClose={() => {}}
          onCallTerminated={() => {}}
          userId="user-1"
          fallbackOrder={{ ...order, prior_order_count: 4, prior_rejected_count: 1, prior_returned_count: 1, prior_delivered_count: 2 }}
        />,
      );
      expect(screen.getByTestId("customer-reliability")).toHaveClass("h-red");
    });

    it("tells a shipped order to be reopened before editing", () => {
      currentOrder = { ...order, status: "delivered" };
      render(<OrderDetailPanel orderId="order-1" onClose={() => {}} onCallTerminated={() => {}} userId="user-1" />);
      expect(screen.getByText("أعد فتح الطلب لتعديل تفاصيله.")).toBeInTheDocument();
    });
  });

  describe("under the call sheet", () => {
    // The panel now stays open beneath the sheet. Both listen for Escape on
    // `document`, so without this one press closed both layers at once.
    it("stands down its Escape while the call sheet covers it", () => {
      const onClose = vi.fn();
      const props = { orderId: "order-1", onClose, onCallTerminated: () => {}, userId: "user-1" };
      const { rerender } = render(<OrderDetailPanel {...props} covered />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();

      rerender(<OrderDetailPanel {...props} covered={false} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("on a phone", () => {
    const setPhone = (matches: boolean) => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as typeof window.matchMedia;
    };
    const renderPanel = () =>
      render(
        <OrderDetailPanel orderId="order-1" onClose={() => {}} onCallTerminated={() => {}} userId="user-1" variant="side" />,
      );

    // The masthead used to be its own capped scroll box above a second one
    // for the receipt. On an iPhone SE that left the receipt 18px of height,
    // and a drag on the customer's name scrolled a box nobody could see the
    // edges of.
    it("scrolls the customer, the tabs and the receipt as one region", () => {
      renderPanel();
      const scroller = screen.getByTestId("panel-scroll");
      expect(scroller.contains(screen.getByRole("region", { name: "العميل" }))).toBe(true);
      expect(scroller.contains(screen.getByRole("tablist"))).toBe(true);
      expect(scroller.contains(screen.getAllByRole("tabpanel")[0])).toBe(true);
    });

    it("pins the tab strip in the prototype's sticky track (it scrolls sideways on a phone)", () => {
      renderPanel();
      expect(screen.getByRole("tablist").parentElement).toHaveClass("tabwrap");
    });

    // The call and WhatsApp buttons shared a row with the name and a
    // `flex-none` reliability pill, which squeezed the name to one letter a
    // line on a 375px screen.
    it("keeps calling in the client block's button group (its own row on a phone)", () => {
      renderPanel();
      expect(screen.getByRole("link", { name: /اتصال/ }).parentElement).toHaveClass("pc-btns");
    });

    it("holds the queue behind it still while an order is open", () => {
      setPhone(true);
      const view = renderPanel();
      expect(document.body.style.overflow).toBe("hidden");
      view.unmount();
      expect(document.body.style.overflow).toBe("");
    });

    it("leaves the queue scrollable on a desktop, where the panel sits beside it", () => {
      setPhone(false);
      renderPanel();
      expect(document.body.style.overflow).toBe("");
    });
  });

  describe("DexpressStatusSection eligibility gating", () => {
    const DEXPRESS_CARRIER_ID = "dx-carrier-uuid";
    const NAVEX_CARRIER_ID = "nx-carrier-uuid";

    it("mounts DexpressStatusSection with enabled=true when carrier is Dexpress and tracking_number is set", () => {
      currentOrder = {
        ...order,
        status: "uploaded",
        tracking_number: "1343188",
        carrier_id: DEXPRESS_CARRIER_ID,
      };
      currentCarriers = [
        { id: DEXPRESS_CARRIER_ID, name: "Dexpress", code: "dexpress", is_active: true },
      ];

      render(
        <OrderDetailPanel
          orderId="order-1"
          onClose={() => {}}
          onCallTerminated={() => {}}
          userId="user-1"
        />,
      );

      expect(dexpressSectionSpy).toHaveBeenCalled();
      const lastProps = dexpressSectionSpy.mock.calls[dexpressSectionSpy.mock.calls.length - 1][0];
      expect(lastProps).toMatchObject({
        orderId: "order-1",
        enabled: true,
      });
    });

    it("mounts DexpressStatusSection with enabled=false when carrier is not Dexpress", () => {
      currentOrder = {
        ...order,
        status: "uploaded",
        tracking_number: "TUN-99",
        carrier_id: NAVEX_CARRIER_ID,
      };
      currentCarriers = [
        { id: NAVEX_CARRIER_ID, name: "Navex", code: "navex", is_active: true },
      ];

      render(
        <OrderDetailPanel
          orderId="order-1"
          onClose={() => {}}
          onCallTerminated={() => {}}
          userId="user-1"
        />,
      );

      // Section mounts (cheap, returns null when enabled=false) — the gate
      // is the `enabled` prop, not the JSX conditional.
      expect(dexpressSectionSpy).toHaveBeenCalled();
      const lastProps = dexpressSectionSpy.mock.calls[dexpressSectionSpy.mock.calls.length - 1][0];
      expect(lastProps.enabled).toBe(false);
    });

    it("mounts DexpressStatusSection with enabled=false when tracking_number is null", () => {
      currentOrder = {
        ...order,
        status: "pending",
        tracking_number: null,
        carrier_id: null,
      };
      currentCarriers = [
        { id: DEXPRESS_CARRIER_ID, name: "Dexpress", code: "dexpress", is_active: true },
      ];

      render(
        <OrderDetailPanel
          orderId="order-1"
          onClose={() => {}}
          onCallTerminated={() => {}}
          userId="user-1"
        />,
      );

      expect(dexpressSectionSpy).toHaveBeenCalled();
      const lastProps = dexpressSectionSpy.mock.calls[dexpressSectionSpy.mock.calls.length - 1][0];
      expect(lastProps.enabled).toBe(false);
    });
  });
});
