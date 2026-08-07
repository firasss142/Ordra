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

vi.mock("@/hooks/useOrderMutation", () => ({
  useOrderMutation: () => ({
    commit: vi.fn(),
    patchItemOptimistic: vi.fn(),
    deleteItemOptimistic: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrderDetailRealtime", () => ({
  useOrderDetailRealtime: () => {},
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
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(arMessages, ns, key, params),
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
    expect(screen.getAllByText("LBY").length).toBeGreaterThan(0);
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
    expect(screen.getByText("التتبع")).not.toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: /livraison|التوصيل/i }));

    expect(screen.getByText("التتبع")).toBeVisible();
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
