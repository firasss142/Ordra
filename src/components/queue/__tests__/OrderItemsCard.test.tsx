import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrderItemsCard, type OrderItemsCardProps } from "../OrderDetailPanel/OrderItemsCard";
import type { OrderItem } from "../OrderDetailPanel/types";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const arMessages = (await import("@/messages/ar.json")).default;
  return {
    useTranslations:
      (ns: string) => (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(arMessages, ns, key, params),
  };
});

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "item-1",
    order_id: "order-1",
    product_id: "p-1",
    product_name: "Widget",
    variant_id: null,
    variant_label: null,
    quantity: 1,
    unit_price: 50,
    line_total: 50,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderCard(overrides: Partial<OrderItemsCardProps> = {}) {
  const onPatchItem = vi.fn();
  const onCommitLegacyPrice = vi.fn();
  const props: OrderItemsCardProps = {
    items: [makeItem()],
    currentProductId: "p-1",
    products: [{ id: "p-1", current_stock: 10, product_variants: [] }],
    variantOptions: [],
    loadProducts: async () => [],
    deliveryFee: 0,
    cardPayment: false,
    grandTotal: 50,
    displayCurrency: "DT",
    canEdit: true,
    isLibyaOrder: false,
    saveError: null,
    onCommitLegacyProduct: vi.fn(),
    onCommitLegacyQuantity: vi.fn(),
    onCommitLegacyPrice,
    onCommitLegacyVariant: vi.fn(),
    onPatchItem,
    onDeleteItem: vi.fn(),
    onCommitDeliveryFee: vi.fn(),
    renderAddProduct: () => null,
    ...overrides,
  };
  render(<OrderItemsCard {...props} />);
  return { onPatchItem, onCommitLegacyPrice, props };
}

describe("OrderItemsCard — editable unit_price", () => {
  it("renders the unit price and turns it into a number input on click when editable", () => {
    renderCard();
    // Price text "50" is shown (also the quantity is 1; assert price specifically via click-to-edit).
    const priceText = screen.getAllByText("50")[0];
    fireEvent.click(priceText);
    const input = screen.getByDisplayValue("50") as HTMLInputElement;
    expect(input.type).toBe("number");
  });

  it("committing a new price calls onPatchItem with { unit_price }", () => {
    const { onPatchItem } = renderCard();
    const priceText = screen.getAllByText("50")[0];
    fireEvent.click(priceText);
    const input = screen.getByDisplayValue("50");
    fireEvent.change(input, { target: { value: "75" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPatchItem).toHaveBeenCalledWith("item-1", { unit_price: 75 });
  });

  it("does not allow editing the price when canEdit is false", () => {
    renderCard({ canEdit: false });
    const priceText = screen.getAllByText("50")[0];
    fireEvent.click(priceText);
    expect(screen.queryByDisplayValue("50")).toBeNull();
  });

  it("lets the synthetic legacy row edit its price via onCommitLegacyPrice", () => {
    const { onCommitLegacyPrice, onPatchItem } = renderCard({
      items: [makeItem({ id: "legacy" })],
    });
    const priceText = screen.getAllByText("50")[0];
    fireEvent.click(priceText);
    const input = screen.getByDisplayValue("50");
    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitLegacyPrice).toHaveBeenCalledWith(90);
    expect(onPatchItem).not.toHaveBeenCalled();
  });

  it("rejects a negative price without calling onPatchItem", () => {
    const { onPatchItem } = renderCard();
    const priceText = screen.getAllByText("50")[0];
    fireEvent.click(priceText);
    const input = screen.getByDisplayValue("50");
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPatchItem).not.toHaveBeenCalled();
  });
});

describe("OrderItemsCard — the receipt", () => {
  it("shows the items without asking to be opened first", () => {
    // The tab is already the disclosure. A card inside it that also collapsed
    // meant opening a panel to check a receipt, then clicking again to see it.
    renderCard();
    expect(screen.queryByTestId("order-details-toggle")).toBeNull();
    expect(screen.getByText("Widget")).toBeInTheDocument();
  });

  it("breaks the total down instead of jumping straight to it", () => {
    renderCard({ items: [makeItem({ line_total: 50 })], deliveryFee: 7, grandTotal: 57 });
    expect(screen.getByTestId("items-subtotal")).toHaveTextContent("50.00");
    expect(screen.getByTestId("items-grand-total")).toHaveTextContent("57.00");
  });

  it("states the grand total the way the table and the facts grid state it", () => {
    // Same money, three places, one reading — two decimals, currency demoted.
    renderCard({ grandTotal: 129 });
    const total = screen.getByTestId("items-grand-total");
    expect(total.textContent).toContain("129.00");
    expect(total.textContent).toContain("DT");
  });

  it("reports stock in words, not by colour alone", () => {
    renderCard({ products: [{ id: "p-1", current_stock: 0, product_variants: [] }] });
    expect(screen.getByTestId("item-stock-item-1")).toHaveTextContent(/.+/);
  });
});
