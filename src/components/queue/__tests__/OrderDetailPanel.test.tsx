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

vi.mock("swr", () => ({ default: vi.fn() }));

vi.mock("@/hooks/useOrderMutation", () => ({
  useOrderMutation: () => ({ commit: vi.fn() }),
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

describe("OrderDetailPanel", () => {
  beforeEach(() => {
    currentOrder = order;
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

  it("keeps history collapsed until the dropdown is opened", () => {
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

    expect(screen.queryByRole("list")).toBeNull();

    const historyButton = screen.getByTestId("order-history-toggle");
    expect(historyButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(historyButton);

    expect(screen.getByRole("list")).toBeTruthy();
    expect(historyButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("قيد الانتظار").length).toBeGreaterThan(0);
    expect(screen.getByText("تم استلام الطلب من تكامل المتجر")).toBeTruthy();
    expect(screen.queryByText("pending")).toBeNull();
  });
});
