import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { CustomerHistoryModal } from "../CustomerHistoryModal";
import type { CustomerHistoryOrder } from "@/hooks/useCustomerHistory";

const mockHistory = vi.fn();
vi.mock("@/hooks/useCustomerHistory", () => ({
  useCustomerHistory: (...a: unknown[]) => mockHistory(...a),
}));

function apiOrder(o: Partial<CustomerHistoryOrder> = {}): CustomerHistoryOrder {
  return {
    id: "h-1",
    external_id: "EXT-HIST",
    created_at: "2026-06-10T13:54:00Z",
    status: "uploaded",
    total_price: 387,
    customer_name: "لطفي الصفح",
    customer_address: null,
    customer_city: "طرابلس",
    product_name: "دميه ملاكمه حجم صغير",
    product_image_url: null,
    quantity: 3,
    variant_label: null,
    phone_matched: true,
    ...o,
  };
}

/** The real anchor: this customer's delivered order. */
const ANCHOR = {
  anchorOrderId: "anchor-1",
  anchorExternalId: "6a315fd53fcb68dcd2380589",
  anchorStatus: "delivered",
  anchorCreatedAt: "2026-06-16T15:00:00Z",
  anchorTotalPrice: 129,
  anchorProductName: "دميه ملاكمه حجم صغير",
  anchorProductImageUrl: null,
  anchorQuantity: 1,
  anchorCustomerName: "لطفي الصفح",
  anchorCustomerCity: "طرابلس",
};

function renderModal(
  props: Partial<React.ComponentProps<typeof CustomerHistoryModal>> = {},
) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <CustomerHistoryModal
        open
        onClose={onClose}
        source="order"
        sourceId="anchor-1"
        currencyCode="LYD"
        customerPhone="0915489053"
        {...ANCHOR}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHistory.mockReturnValue({
    detail: {
      orders: [
        apiOrder(),
        apiOrder({
          id: "h-2",
          external_id: "EXT-OLD",
          created_at: "2026-05-29T14:15:00Z",
          status: "rejected",
          total_price: 129,
          quantity: 1,
        }),
      ],
      leads: [],
      stats: {
        // What the RPC really returns for this customer: the anchor is absent,
        // so delivered_count and lifetime_value are both zero.
        total_orders: 2,
        delivered_count: 0,
        returned_count: 0,
        rejected_count: 1,
        lifetime_value: 0,
      },
    },
    isLoading: false,
    error: null,
  });
});

describe("CustomerHistoryModal", () => {
  it("renders nothing until it is opened", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fetches only once opened", () => {
    renderModal({ open: false });
    expect(mockHistory).toHaveBeenCalledWith("order", "anchor-1", false);
  });

  it("lists the customer's orders together with the one in hand", async () => {
    renderModal();
    expect(await screen.findByText(/6a315fd5/)).toBeInTheDocument();
    expect(screen.getByText(/EXT-HIST/)).toBeInTheDocument();
    expect(screen.getByText(/EXT-OLD/)).toBeInTheDocument();
  });

  it("marks which row is the order you came from", async () => {
    renderModal();
    expect(await screen.findByText(fr.customerHistory.modal.thisOrder)).toBeInTheDocument();
  });

  /**
   * The bug: the RPC's stats exclude the anchor, so a delivered customer reads
   * "0 livrées · 0 LYD". The panel must count the row it is showing.
   */
  it("counts the anchor order in the delivered total", async () => {
    renderModal();
    const delivered = await screen.findByTestId("ch-delivered");
    expect(delivered).toHaveTextContent("1");
    expect(delivered).toHaveTextContent("129");
  });

  it("keeps money still in transit out of the delivered total", async () => {
    renderModal();
    expect(await screen.findByTestId("ch-delivered")).not.toHaveTextContent("387");
    expect(screen.getByTestId("ch-inflight")).toHaveTextContent("387");
  });

  it("shows each rate with the orders it was drawn from", async () => {
    renderModal();
    // 1 delivered of 1 concluded, 2 confirmed of 3 decided.
    expect(await screen.findByTestId("ch-delivery-rate")).toHaveTextContent("100");
    expect(screen.getByTestId("ch-delivery-rate")).toHaveTextContent("1");
    expect(screen.getByTestId("ch-confirmation-rate")).toHaveTextContent("67");
    expect(screen.getByTestId("ch-confirmation-rate")).toHaveTextContent("3");
  });

  it("says when a rate rests on too few orders", async () => {
    renderModal();
    expect(await screen.findByText(fr.customerHistory.modal.thinBase)).toBeInTheDocument();
  });

  it("shows no percentage at all when nothing has concluded", async () => {
    mockHistory.mockReturnValue({
      detail: {
        orders: [apiOrder({ status: "uploaded" })],
        leads: [],
        stats: { total_orders: 1, delivered_count: 0, returned_count: 0, rejected_count: 0, lifetime_value: 0 },
      },
      isLoading: false,
      error: null,
    });
    // Anchor also undecided, so there is no basis for a delivery rate.
    renderModal({ anchorStatus: "pending" });
    const rate = await screen.findByTestId("ch-delivery-rate");
    expect(rate).not.toHaveTextContent("%");
    expect(rate).toHaveTextContent(fr.customerHistory.modal.noBasis);
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: fr.customerHistory.modal.close }));
    expect(onClose).toHaveBeenCalled();
  });

  it("reports a load failure instead of an empty history", async () => {
    mockHistory.mockReturnValue({ detail: null, isLoading: false, error: new Error("x") });
    renderModal();
    expect(await screen.findByText(fr.customerHistory.modal.error)).toBeInTheDocument();
  });

  it("shows a loading state while fetching", () => {
    mockHistory.mockReturnValue({ detail: null, isLoading: true, error: null });
    renderModal();
    expect(screen.getByText(fr.customerHistory.modal.loading)).toBeInTheDocument();
  });

  it("still shows the order in hand when the customer has no other orders", async () => {
    mockHistory.mockReturnValue({
      detail: {
        orders: [],
        leads: [],
        stats: { total_orders: 0, delivered_count: 0, returned_count: 0, rejected_count: 0, lifetime_value: 0 },
      },
      isLoading: false,
      error: null,
    });
    renderModal();
    expect(await screen.findByText(/6a315fd5/)).toBeInTheDocument();
    expect(screen.getByTestId("ch-shown")).toHaveTextContent("1");
  });
});
