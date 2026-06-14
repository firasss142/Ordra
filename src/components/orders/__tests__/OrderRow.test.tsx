import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrderRow } from "../OrderRow";
import type { OrdersListRow } from "@/hooks/useOrdersList";
import { formatDateTime } from "@/lib/format";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("@/components/shared/RepeatBuyerBadge", () => ({
  RepeatBuyerBadge: () => null,
}));

const mockOrder: OrdersListRow = {
  id: "order-abc-123",
  external_id: "3047",
  external_platform: "shopify",
  market_id: "market-tn",
  customer_name: "Karim Gharbi",
  customer_phone: "22123456",
  customer_address: "10 Av. Habib Bourguiba",
  customer_city: "Tunis",
  product_id: "prod-1",
  product_name: "T-Shirt Premium",
  product_image_url: null,
  variant_label: "L / Rouge",
  quantity: 2,
  total_price: 89.9,
  status: "confirmed",
  assigned_to: "agent-1",
  carrier_id: null,
  rejection_reason: null,
  carrier_barcode_deleted_at: null,
  carrier_barcode_deleted_carrier_code: null,
  callback_scheduled_at: null,
  created_at: "2026-05-20T14:32:00",
  updated_at: new Date().toISOString(),
  repeat_kind: "none",
  prior_order_count: 0,
  prior_lead_count: 0,
  prior_rejected_count: 0,
};

const defaultProps = {
  order: mockOrder,
  locale: "fr",
  selected: false,
  highlighted: false,
  agentName: "Agent One",
  currencyCode: "TND",
  labels: {
    status: "Confirmé",
    unassigned: "Non assigné",
    cancel: "Annuler",
    recover: "Restaurer",
    actions: "Actions",
    callbackOverdue: "en retard",
    priorRejected: "0 rejet(s) précédent(s)",
    carrierBarcodeDeleted: "Dexpress annulé",
  },
  onToggleSelect: vi.fn(),
  onOpen: vi.fn(),
  onCancel: vi.fn(),
  cancellingId: null,
  onRecover: undefined as ((id: string) => void) | undefined,
  recoveringId: null as string | null,
};

function renderRow(props: Partial<typeof defaultProps> = {}) {
  return render(
    <table>
      <tbody>
        <OrderRow {...defaultProps} {...props} />
      </tbody>
    </table>,
  );
}

describe("OrderRow", () => {
  it("renders order ID with # prefix", () => {
    renderRow();
    expect(screen.getByText("#3047")).toBeDefined();
  });

  it("renders product name", () => {
    renderRow();
    expect(screen.getByText("T-Shirt Premium")).toBeDefined();
  });

  it("renders letter-avatar fallback when product_image_url is null", () => {
    renderRow();
    // ProductAvatar renders the first letter when no image is provided
    expect(screen.getByText("T")).toBeDefined();
  });

  it("renders product image when product_image_url is set", () => {
    renderRow({
      order: {
        ...mockOrder,
        product_image_url: "https://example.com/shirt.png",
      },
    });
    const img = screen.getByRole("img", { name: "T-Shirt Premium" });
    expect(img).toBeDefined();
    expect(img.getAttribute("src")).toBe("https://example.com/shirt.png");
  });

  it("renders variant label when present", () => {
    renderRow();
    expect(screen.getByText(/L \/ Rouge/)).toBeDefined();
  });

  it("does not render variant label when null", () => {
    renderRow({ order: { ...mockOrder, variant_label: null } });
    expect(screen.queryByText(/L \/ Rouge/)).toBeNull();
  });

  it("renders ×N when quantity > 1", () => {
    renderRow();
    expect(screen.getByText("×2")).toBeDefined();
  });

  it("renders ×1 when quantity is 1", () => {
    renderRow({ order: { ...mockOrder, quantity: 1 } });
    expect(screen.getByText("×1")).toBeDefined();
  });

  it("renders customer name", () => {
    renderRow();
    expect(screen.getByText("Karim Gharbi")).toBeDefined();
  });

  it("renders customer city next to the name", () => {
    renderRow();
    expect(screen.getByText(/Tunis/)).toBeDefined();
  });

  it("renders status as a badge", () => {
    renderRow();
    expect(screen.getByText("Confirmé")).toBeDefined();
  });

  it("renders assignee name", () => {
    renderRow();
    expect(screen.getByText("Agent One")).toBeDefined();
  });

  it("does not render an inline cancel button (action lives in the kebab menu)", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: /annuler/i })).toBeNull();
  });

  it("renders the actions kebab button for non-terminal statuses", () => {
    renderRow();
    expect(screen.getByRole("button", { name: /actions/i })).toBeDefined();
  });

  it("hides the kebab button for terminal statuses", () => {
    renderRow({ order: { ...mockOrder, status: "delivered" } });
    expect(screen.queryByRole("button", { name: /actions/i })).toBeNull();
  });

  it("hides the kebab button for non-terminal statuses that cannot be manually deleted", () => {
    renderRow({ order: { ...mockOrder, status: "dispatched" } });
    expect(screen.queryByRole("button", { name: /actions/i })).toBeNull();
  });

  it("opens the kebab menu and exposes a cancel item", async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole("button", { name: /actions/i }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /annuler/i })).toBeDefined();
  });

  it("calls onCancel when the cancel menu item is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderRow({ onCancel });
    await user.click(screen.getByRole("button", { name: /actions/i }));
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: /annuler/i }),
    );
    expect(onCancel).toHaveBeenCalledWith("order-abc-123");
  });

  it("calls onOpen when row is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderRow({ onOpen });
    await user.click(screen.getByText("T-Shirt Premium"));
    expect(onOpen).toHaveBeenCalledWith("order-abc-123");
  });

  it("calls onToggleSelect when checkbox is changed", async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    renderRow({ onToggleSelect });
    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith("order-abc-123");
  });

  it("renders a risk dot when prior_rejected_count > 0", () => {
    const { container } = renderRow({
      order: { ...mockOrder, prior_rejected_count: 2 },
      labels: {
        ...defaultProps.labels,
        priorRejected: "2 rejet(s) précédent(s)",
      },
    });
    const dot = container.querySelector('[title="2 rejet(s) précédent(s)"]');
    expect(dot).not.toBeNull();
  });

  it("does not render a risk dot when prior_rejected_count is 0", () => {
    const { container } = renderRow();
    const dot = container.querySelector('[title^="0 rejet"]');
    expect(dot).toBeNull();
  });

  it("renders the callback-overdue flag when callback_scheduled_at is in the past", () => {
    renderRow({
      order: {
        ...mockOrder,
        status: "callback_scheduled",
        callback_scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(screen.getByText("en retard")).toBeDefined();
  });

  it("does not render the callback-overdue flag when callback_scheduled_at is in the future", () => {
    renderRow({
      order: {
        ...mockOrder,
        status: "callback_scheduled",
        callback_scheduled_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
    });
    expect(screen.queryByText("en retard")).toBeNull();
  });

  it("renders the formatted creation date/time", () => {
    renderRow();
    expect(screen.getByText(formatDateTime(mockOrder.created_at, "fr"))).toBeDefined();
  });

  it("renders a Date cell in the row", () => {
    const { container } = renderRow();
    // 8 cells: checkbox, order, price, status, date, assignee, source, actions
    expect(container.querySelectorAll("td").length).toBe(8);
  });

  it("hides the kebab for deleted orders when no onRecover is provided", () => {
    renderRow({ order: { ...mockOrder, status: "deleted" } });
    expect(screen.queryByRole("button", { name: /actions/i })).toBeNull();
  });

  it("shows a Recover item for deleted orders when onRecover is provided", async () => {
    const user = userEvent.setup();
    renderRow({ order: { ...mockOrder, status: "deleted" }, onRecover: vi.fn() });
    await user.click(screen.getByRole("button", { name: /actions/i }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /restaurer/i })).toBeDefined();
    // Cancel must NOT appear for a deleted order.
    expect(within(menu).queryByRole("menuitem", { name: /^annuler/i })).toBeNull();
  });

  it("calls onRecover when the recover menu item is clicked", async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    renderRow({ order: { ...mockOrder, status: "deleted" }, onRecover });
    await user.click(screen.getByRole("button", { name: /actions/i }));
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: /restaurer/i }),
    );
    expect(onRecover).toHaveBeenCalledWith("order-abc-123");
  });

  it("hides the duplicate badge when the anchor row is deleted", () => {
    const { container } = renderRow({
      order: {
        ...mockOrder,
        status: "deleted",
        is_potential_duplicate: true,
        is_duplicate_anchor: true,
        duplicate_count: 2,
        duplicate_siblings: [
          {
            id: "sibling-1",
            external_id: "3048",
            status: "confirmed",
            created_at: "2026-05-20T15:00:00",
            product_name: "T-Shirt Premium",
            product_image_url: null,
            quantity: 2,
            total_price: 89.9,
            customer_name: "Karim Gharbi",
            customer_address: null,
            customer_city: "Tunis",
            already_shipped: false,
          },
        ],
        has_uploaded_sibling: false,
      } as OrdersListRow,
    });
    expect(container.querySelector('[data-duplicate="true"]')).toBeNull();
  });
});
