import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { RepeatBuyerBadge } from "./RepeatBuyerBadge";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params) {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val,
        );
      }
      return val;
    };
    return resolve;
  },
  useLocale: () => "fr",
}));

// History mock — defaults to no detail, overridden per-test via `setHistoryDetail`.
let mockHistoryDetail:
  | {
      orders: Array<{
        id: string;
        external_id: string | null;
        created_at: string;
        status: string;
        total_price: number;
        customer_name: string | null;
        customer_address: string | null;
        customer_city: string | null;
        product_name: string | null;
        product_image_url: string | null;
        quantity: number | null;
        variant_label: string | null;
        phone_matched: boolean;
      }>;
      leads: Array<unknown>;
      stats: {
        total_orders: number;
        delivered_count: number;
        returned_count: number;
        rejected_count: number;
        lifetime_value: number;
      };
    }
  | null = null;
function setHistoryDetail(detail: typeof mockHistoryDetail) {
  mockHistoryDetail = detail;
}
vi.mock("@/hooks/useCustomerHistory", () => ({
  useCustomerHistory: () => ({ detail: mockHistoryDetail, isLoading: false, error: null }),
}));

describe("RepeatBuyerBadge", () => {
  const baseProps = {
    source: "order" as const,
    sourceId: "order-1",
    priorOrderCount: 0,
    priorLeadCount: 0,
    priorRejectedCount: 0,
    currencyCode: "LBY",
    // Hovered order (anchor) — required for the popover card.
    anchorOrderId: "order-1",
    anchorStatus: "pending",
    anchorCreatedAt: "2026-05-22T10:00:00Z",
    anchorTotalPrice: 129 as number | null,
    anchorProductName: "T-Shirt",
    anchorProductImageUrl: null,
    anchorCustomerName: "Anchor Customer",
    anchorCustomerAddress: "1 Anchor Rd",
    anchorCustomerCity: "Tripoli",
  };

  it("renders nothing for repeat_kind='none'", () => {
    const { container } = render(
      <RepeatBuyerBadge {...baseProps} repeatKind="none" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the count for repeat_kind='repeat'", () => {
    const { container } = render(
      <RepeatBuyerBadge
        {...baseProps}
        repeatKind="repeat"
        priorOrderCount={3}
      />,
    );
    expect(screen.getByText("3")).toBeDefined();
    expect(container.querySelector("[data-repeat-kind='repeat']")).not.toBeNull();
  });

  it("renders the count for repeat_kind='likely'", () => {
    const { container } = render(
      <RepeatBuyerBadge
        {...baseProps}
        repeatKind="likely"
        priorOrderCount={2}
      />,
    );
    expect(screen.getByText("2")).toBeDefined();
    expect(container.querySelector("[data-repeat-kind='likely']")).not.toBeNull();
  });

  it("renders rejected count for repeat_kind='risk'", () => {
    const { container } = render(
      <RepeatBuyerBadge
        {...baseProps}
        repeatKind="risk"
        priorOrderCount={3}
        priorRejectedCount={2}
      />,
    );
    const badge = container.querySelector("[data-repeat-kind='risk']");
    expect(badge).not.toBeNull();
    expect(screen.getByText("2")).toBeDefined();
  });

  it("includes a data-repeat-kind attribute matching the kind", () => {
    const { container } = render(
      <RepeatBuyerBadge {...baseProps} repeatKind="repeat" priorOrderCount={1} />,
    );
    expect(
      container.querySelector("[data-repeat-kind='repeat']"),
    ).not.toBeNull();
  });

  it("shows the hovered order alongside its history, sorted by date, with count N+1", () => {
    setHistoryDetail({
      orders: [
        {
          id: "older-1",
          external_id: "EXT-A",
          created_at: "2026-05-20T10:00:00Z", // older than the anchor (05-22)
          status: "delivered",
          total_price: 50,
          customer_name: "Anchor Customer",
          customer_address: "1 Anchor Rd",
          customer_city: "Tripoli",
          product_name: "T-Shirt",
          product_image_url: null,
          quantity: 1,
          variant_label: null,
          phone_matched: true,
        },
        {
          id: "newer-1",
          external_id: "EXT-B",
          created_at: "2026-05-23T10:00:00Z", // NEWER than the anchor
          status: "pending",
          total_price: 75,
          customer_name: "Anchor Customer",
          customer_address: "1 Anchor Rd",
          customer_city: "Tripoli",
          product_name: "T-Shirt",
          product_image_url: null,
          quantity: 1,
          variant_label: null,
          phone_matched: true,
        },
      ],
      leads: [],
      stats: {
        total_orders: 2,
        delivered_count: 1,
        returned_count: 0,
        rejected_count: 0,
        lifetime_value: 50,
      },
    });

    const { container } = render(
      <RepeatBuyerBadge {...baseProps} repeatKind="repeat" priorOrderCount={2} />,
    );
    // Hover the wrapper to open the popover.
    fireEvent.mouseEnter(container.querySelector("[data-repeat-kind='repeat']")!.parentElement!);

    // Popover is portaled to document.body.
    const cards = document.body.querySelectorAll("[data-related-order]");
    expect(cards).toHaveLength(3);
    // Sorted newest-first: newer history (75) > anchor (129) > older history (50).
    expect(cards[0].getAttribute("data-anchor")).toBeNull();
    expect(cards[0].textContent).toContain("75.00");
    expect(cards[1].getAttribute("data-anchor")).toBe("true");
    expect(cards[1].textContent).toContain("129.00");
    expect(cards[2].getAttribute("data-anchor")).toBeNull();
    expect(cards[2].textContent).toContain("50.00");

    // Header count is N+1 (2 history + 1 hovered = 3).
    expect(screen.getByText(/Total des commandes : 3/)).toBeDefined();

    setHistoryDetail(null);
  });

  it("renders a lead anchor card with no price block when anchorTotalPrice is null", () => {
    setHistoryDetail({
      orders: [],
      leads: [],
      stats: { total_orders: 0, delivered_count: 0, returned_count: 0, rejected_count: 0, lifetime_value: 0 },
    });

    const { container } = render(
      <RepeatBuyerBadge
        {...baseProps}
        repeatKind="likely"
        priorOrderCount={0}
        priorLeadCount={1}
        // Lead overrides: no price, no product.
        anchorTotalPrice={null}
        anchorProductName={null}
        anchorProductImageUrl={null}
        anchorStatus="callback_scheduled"
      />,
    );
    fireEvent.mouseEnter(container.querySelector("[data-repeat-kind='likely']")!.parentElement!);

    const cards = document.body.querySelectorAll("[data-related-order]");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-anchor")).toBe("true");
    // No price means the LBY currency suffix should not render.
    expect(cards[0].textContent).not.toContain("LBY");

    setHistoryDetail(null);
  });

  describe("« Voir toutes les commandes »", () => {
    const EMPTY_HISTORY = {
      orders: [],
      leads: [],
      stats: {
        total_orders: 0,
        delivered_count: 0,
        returned_count: 0,
        rejected_count: 0,
        lifetime_value: 0,
      },
    };

    function openPopover() {
      setHistoryDetail(EMPTY_HISTORY);
      const { container } = render(
        <RepeatBuyerBadge
          {...baseProps}
          repeatKind="repeat"
          priorOrderCount={2}
          customerPhone="0915489053"
        />,
      );
      fireEvent.mouseEnter(
        container.querySelector("[data-repeat-kind='repeat']")!.parentElement!,
      );
      return screen.getByText(frMessages.customerHistory.popover.seeAll).closest("button, a")!;
    }

    /**
     * The whole point of the change. It used to be an <a target="_blank">, which
     * threw the agent into a second tab mid-call and lost the row they were on.
     */
    it("is a button, not a link that opens another tab", () => {
      const trigger = openPopover();
      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger).not.toHaveAttribute("href");
      expect(trigger).not.toHaveAttribute("target");
      setHistoryDetail(null);
    });

    it("opens the history panel in the same page", () => {
      const trigger = openPopover();
      // The hover card itself carries role="dialog", so the panel has to be
      // addressed by its accessible name rather than by role alone.
      const byName = { name: frMessages.customerHistory.modal.title };
      expect(screen.queryByRole("dialog", byName)).not.toBeInTheDocument();

      fireEvent.click(trigger);

      expect(screen.getByRole("dialog", byName)).toBeInTheDocument();
      setHistoryDetail(null);
    });

    it("shows the order in hand even when the customer has no other orders", () => {
      const trigger = openPopover();
      fireEvent.click(trigger);
      // The anchor is folded in, so the panel is never empty.
      expect(screen.getByTestId("ch-shown")).toHaveTextContent("1");
      setHistoryDetail(null);
    });
  });
});
