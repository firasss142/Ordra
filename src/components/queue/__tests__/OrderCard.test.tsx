import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrderCard } from "../OrderCard";
import type { QueueOrder } from "@/types/queue";
import { formatLongDate, formatDateTime } from "@/lib/format";

const intlMockState = vi.hoisted(() => ({ locale: "fr" }));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  const arMessages = (await import("@/messages/ar.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(intlMockState.locale === "ar" ? arMessages : frMessages, ns, key, params),
    useLocale: () => intlMockState.locale,
  };
});

afterEach(() => {
  intlMockState.locale = "fr";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mockOrder: QueueOrder = {
  id: "order-1",
  customer_name: "Ahmed Gharbi",
  customer_phone: "22123456",
  customer_address: null,
  customer_city: "Tunis",
  product_name: "T-Shirt Premium",
  variant_label: "L / Rouge",
  quantity: 1,
  product_image_url: null,
  carrier_id: null,
  carrier_code: null,
  carrier_name: null,
  total_price: 89.9,
  currency: "TND",
  market_id: "00000000-0000-0000-0000-000000000001",
  attempt_count: 0,
  callback_time: null,
  scheduled_dispatch_at: null,
  scheduled_dispatch_auto: false,
  customer_note: "Livrer avant midi",
  customer_phone_2: null,
  status: "assigned",
  created_at: "2026-04-10T10:00:00Z",
  assigned_at: "2026-04-10T10:00:00Z",
  last_action_at: null,
  repeat_kind: "none",
  prior_order_count: 0,
  prior_lead_count: 0,
  prior_rejected_count: 0,
  last_known_address: null,
  rejection_reason: null,
  rejection_subreason: null,
  rejection_note: null,
  is_potential_duplicate: false,
  duplicate_count: 0,
  duplicate_siblings: [],
  has_uploaded_sibling: false,
  is_duplicate_anchor: false,
  tracking_number: null,
  carrier_barcode_deleted_at: null,
  dexpress_status_slug: null,
  dexpress_status_synced_at: null,
  dexpress_status_accepted: null,
  carrier_status_slug: null,
  carrier_status_synced_at: null,
};

describe("OrderCard", () => {
  it("renders the customer name", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("Ahmed Gharbi")).toBeDefined();
  });

  it("does not render the customer phone number on the card", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.queryByText("22123456")).toBeNull();
    expect(document.querySelector('[data-phone-spot="true"]')).toBeNull();
  });

  it("renders the product image when the product has one", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, product_image_url: "https://cdn/p.png" }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("https://cdn/p.png");
  });

  it("falls back to customer initials when there is no product image", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("AG")).toBeDefined(); // Ahmed Gharbi → AG
  });

  it("renders the product name as a secondary line", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText(/T-Shirt Premium/)).toBeDefined();
  });

  it("renders the variant label alongside the product name", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText(/L \/ Rouge/)).toBeDefined();
  });

  it("renders the quantity badge as ×N (including ×1)", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByLabelText("×1")).toBeDefined();
  });

  it("renders the quantity badge for multi-unit orders", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, quantity: 3 }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByLabelText("×3")).toBeDefined();
  });

  it("renders the carrier logo when a carrier with a known asset is assigned", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, carrier_code: "navex", carrier_name: "Navex", status: "uploaded", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByAltText("Navex")).toBeDefined();
  });

  it("renders a neutral fallback chip for a carrier without a logo asset", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, carrier_code: "cosmos", carrier_name: "Cosmos", status: "dispatched", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    // No image for cosmos (no asset in the logo map) — the fallback chip exposes the name via aria-label.
    expect(screen.queryByAltText("Cosmos")).toBeNull();
    expect(screen.getByLabelText("Cosmos")).toBeDefined();
  });

  it("distinguishes two accounts of the same carrier", () => {
    // Libya runs two Darb Assabil accounts under one code, so both resolve to
    // the same logo file. Without a per-account mark an agent cannot tell a
    // Tripoli shipment from a Benghazi one while scanning.
    const base = { ...mockOrder, carrier_code: "darb_assabil", status: "uploaded", customer_note: null };
    const { container: tripoli } = render(
      <OrderCard
        order={{ ...base, carrier_id: "4f1271c8-b1f2-4836-9293-8ab3d0b18e69", carrier_name: "Darb Assabil - Tripoli" }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    const { container: benghazi } = render(
      <OrderCard
        order={{ ...base, carrier_id: "43077d36-3d61-40d6-ae35-59ed15cec8f7", carrier_name: "Darb Assabil — Benghazi" }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    const ringOf = (c: HTMLElement) =>
      (c.querySelector("[data-carrier-account]") as HTMLElement | null)?.style.getPropertyValue(
        "--tw-ring-color",
      );
    expect(ringOf(tripoli)).toBeTruthy();
    expect(ringOf(benghazi)).toBeTruthy();
    expect(ringOf(tripoli)).not.toBe(ringOf(benghazi));
  });

  it("keeps the account readable without colour", () => {
    // Colour is never the only signal (§4.18) — the account name stays in alt.
    render(
      <OrderCard
        order={{
          ...mockOrder,
          carrier_code: "darb_assabil",
          carrier_id: "43077d36-3d61-40d6-ae35-59ed15cec8f7",
          carrier_name: "Darb Assabil — Benghazi",
          status: "uploaded",
          customer_note: null,
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByAltText("Darb Assabil — Benghazi")).toBeDefined();
  });

  it("gives no account ring to a carrier that runs a single account", () => {
    const { container } = render(
      <OrderCard
        order={{ ...mockOrder, carrier_code: "navex", carrier_id: "n-1", carrier_name: "Navex", status: "uploaded", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(container.querySelector("[data-carrier-account]")).toBeNull();
  });

  it("renders no carrier mark when no carrier is assigned", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    // mockOrder has carrier_code null → only the qty badge image-less avatar, no carrier logo/chip.
    expect(screen.queryByAltText(/navex/i)).toBeNull();
  });

  it("renders total price and currency", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("89.9")).toBeDefined();
    expect(screen.getByText("TND")).toBeDefined();
  });

  it("renders Libya orders with the LBY display currency", () => {
    render(
      <OrderCard
        order={{
          ...mockOrder,
          currency: "TND",
          market_id: "00000000-0000-0000-0000-000000000002",
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("LBY")).toBeDefined();
  });

  it("renders city", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("Tunis")).toBeDefined();
  });

  it("shows how long the customer has waited, not an absolute timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T13:00:00Z"));
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByTestId("order-age").textContent).toBe("3h");
    // The long-form date belongs in the panel, not in a column scanned all day.
    expect(
      screen.queryByText(new RegExp(formatLongDate(mockOrder.created_at, "fr"))),
    ).toBeNull();
  });

  it("carries a second unit once the elapsed time has a remainder", () => {
    // A floored single unit read "3h" for anything from 3h00 to 3h59, so two
    // orders an hour apart in real urgency looked identical.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T13:25:00Z"));
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByTestId("order-age").textContent).toBe("3h 25mn");
  });

  it("keeps the exact timestamp reachable on hover", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T13:00:00Z"));
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByTestId("order-age")).toHaveAttribute(
      "title",
      formatDateTime(mockOrder.created_at, "fr"),
    );
  });

  it("escalates the age only while the order still needs a human", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T10:00:00Z"));
    const { rerender } = render(
      <OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />,
    );
    expect(screen.getByTestId("order-age")).toHaveAttribute("data-tier", "late");

    // Same age, but settled — colouring finished orders red makes the heat map useless.
    rerender(
      <OrderCard
        order={{ ...mockOrder, status: "delivered" }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByTestId("order-age")).toHaveAttribute("data-tier", "settled");
  });

  it("renders the price after the status sign (trailing edge of the card)", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    const price = screen.getByText("89.9");
    const status = screen.getByText("Assigné");
    // Price comes after status in DOM order → it's the last element on the row.
    expect(
      status.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("calls onCallTerminated when Appel terminé is clicked", async () => {
    const user = userEvent.setup();
    const onCallTerminated = vi.fn();
    render(
      <OrderCard
        order={mockOrder}
        onOpenDetail={() => {}}
        onCallTerminated={onCallTerminated}
      />
    );
    // Two instances exist (mobile icon-only + desktop labelled); both wire the
    // same handler — click the first.
    const button = screen.getAllByRole("button", { name: /appel terminé/i })[0];
    await user.click(button);
    expect(onCallTerminated).toHaveBeenCalledWith("order-1");
  });

  it("keeps the customer note reachable without giving it a row of its own", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    // Present in the DOM and named for assistive tech; revealed on hover/focus
    // so row height never depends on whether a customer left a comment.
    expect(screen.getByText("Livrer avant midi")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Note client — Livrer avant midi/ }),
    ).toBeInTheDocument();
  });

  it("does not open the detail panel when the note glyph is clicked", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    render(
      <OrderCard order={mockOrder} onOpenDetail={onOpenDetail} onCallTerminated={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: /Note client/ }));
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("calls onOpenDetail when card is clicked", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    render(
      <OrderCard
        order={mockOrder}
        onOpenDetail={onOpenDetail}
        onCallTerminated={() => {}}
      />
    );
    // Click the outer card div (not a button) — click on name
    await user.click(screen.getByText("Ahmed Gharbi"));
    expect(onOpenDetail).toHaveBeenCalledWith("order-1");
  });

  it("renders customer initials avatar from first + last name", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("AG")).toBeDefined(); // "Ahmed Gharbi" → "AG"
  });

  it("renders checkbox when onToggleSelect is provided", () => {
    render(
      <OrderCard
        order={mockOrder}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
        onToggleSelect={() => {}}
        isSelected={false}
      />
    );
    const checkbox = document.querySelector("[data-checkbox]");
    expect(checkbox).toBeDefined();
  });

  it("does not add the selected border when a card is only focused", () => {
    render(
      <OrderCard
        order={mockOrder}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
        focused
      />,
    );
    const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
    expect(card.className).not.toContain("border-agent-primary");
  });

  it("separates rows with a hairline instead of boxing each one in a coloured border", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
    expect(card.className).toContain("border-b");
    expect(card.className).not.toContain("border-black/35");
  });

  describe("last-action clock", () => {
    it("reads as a dash — not as zero — when no agent has ever acted", () => {
      render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
      const cell = screen.getByTestId("order-last-action");
      expect(cell).toHaveAttribute("data-tier", "never");
      expect(cell.textContent).toBe("—");
    });

    it("measures from the last agent action, independently of the order's age", () => {
      vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T10:00:00Z"));
      render(
        <OrderCard
          order={{
            ...mockOrder,
            status: "attempt_1",
            attempt_count: 1,
            last_action_at: "2026-04-13T08:00:00Z",
          }}
          maxAttempts={8}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      // Three days old, but touched two hours ago — not neglected.
      expect(screen.getByTestId("order-age")).toHaveAttribute("data-tier", "late");
      expect(screen.getByTestId("order-last-action").textContent).toBe("2h");
      expect(screen.getByTestId("order-last-action")).toHaveAttribute("data-tier", "calm");
    });

    it("goes cold on an attempt left untouched with retries still available", () => {
      vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T10:00:00Z"));
      render(
        <OrderCard
          order={{
            ...mockOrder,
            status: "attempt_2",
            attempt_count: 2,
            last_action_at: "2026-04-11T09:00:00Z",
          }}
          maxAttempts={8}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(screen.getByTestId("order-last-action")).toHaveAttribute("data-tier", "cold");
    });
  });

  it("calls onToggleSelect when checkbox is clicked without opening detail", async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    const onOpenDetail = vi.fn();
    render(
      <OrderCard
        order={mockOrder}
        onOpenDetail={onOpenDetail}
        onCallTerminated={() => {}}
        onToggleSelect={onToggleSelect}
        isSelected={false}
      />
    );
    const checkbox = document.querySelector("[data-checkbox]") as HTMLElement;
    await user.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith("order-1");
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("renders uploaded status with purple tone", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, status: "uploaded", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    // Teal, not violet: uploaded is the first state actually with the carrier.
    // Violet stays reserved for phase 1 outcomes that are still the agent's.
    expect(screen.getByText("Téléchargé")).toBeInTheDocument();
    expect(screen.getByTestId("queue-status")).toHaveAttribute("data-hue", "teal");
  });

  it("renders dispatched status as the 'En cours' (deposit) bucket pill", () => {
    // The list pill now reflects the lifecycle bucket, not the raw OMS status.
    // bucketFor() maps status='dispatched' → 'deposit' → cyan En cours pill.
    // See plans/dexpress-list-status-bucket.md.
    render(
      <OrderCard
        order={{ ...mockOrder, status: "dispatched", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("En cours")).toBeInTheDocument();
    expect(screen.getByTestId("queue-status")).toHaveAttribute("data-hue", "teal");
  });

  it("pending-acceptance Dexpress order shows 'Téléchargé' even with a Deposit-shaped slug", () => {
    // Probe 2026-05-29 (tracking 1345233, 1345235): Dexpress reuses the
    // AT_CUSTOMER slug for orders sitting in /merchant/pending-orders. The
    // accepted=false flag overrides the bucket to 'uploaded' so the agent
    // doesn't see "En cours" for orders Dexpress hasn't even acknowledged.
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "uploaded",
          carrier_code: "dexpress",
          dexpress_status_slug: "AT_CUSTOMER",
          dexpress_status_accepted: false,
          customer_note: null,
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("Téléchargé")).toBeInTheDocument();
    expect(screen.getByTestId("queue-status")).toHaveAttribute("data-hue", "teal");
  });

  it("renders rejected status with critical tone", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, status: "rejected", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("Rejeté")).toBeInTheDocument();
    const pill = screen.getByTestId("queue-status");
    expect(pill).toHaveAttribute("data-hue", "red");
    // Red, but quiet: rejection is a normal COD outcome on a quarter of orders,
    // not an emergency on a quarter of orders.
    expect(pill).toHaveAttribute("data-weight", "quiet");
  });

  it("states the rejection reason in the pill, with no hover needed", () => {
    // This used to be a hover popover, which meant the one fact worth knowing
    // about a rejected row was invisible while scanning — and the popover
    // overlapped the rows beneath it.
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "rejected",
          customer_note: null,
          rejection_reason: "refus_client",
          rejection_subreason: "achete_ailleurs",
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("Ailleurs")).toBeInTheDocument();
    // The word "Rejeté" is spent: red + the cross already say that.
    expect(screen.queryByText("Rejeté")).not.toBeInTheDocument();
    expect(screen.getByTestId("queue-status")).toHaveAttribute("data-hue", "red");
  });

  it("falls back to the group when no sub-reason was recorded", () => {
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "rejected",
          customer_note: null,
          rejection_reason: "refus_client",
          rejection_subreason: null,
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("Refus client")).toBeInTheDocument();
  });

  it("shows the free-text note for the 'autre' reason, which has no key", () => {
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "rejected",
          customer_note: null,
          rejection_reason: "autre",
          rejection_subreason: null,
          rejection_note: "Client injoignable depuis 3 jours",
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(
      screen.getByText("Client injoignable depuis 3 jours"),
    ).toBeInTheDocument();
  });

  it("uses attempt_count when max attempts is configured above 3", () => {
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "attempt_3",
          attempt_count: 4,
          customer_note: null,
        }}
        maxAttempts={5}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    // attempt_3 is a cap, not a count — the counter comes from attempt_count.
    expect(screen.getByTestId("queue-status")).toHaveAccessibleName("Tentative 4/5");
    expect(screen.queryByText(/final/)).not.toBeInTheDocument();
  });

  it("does not show a redundant X/Y attempts count at max attempts", () => {
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "attempt_3",
          attempt_count: 3,
          customer_note: null,
        }}
        maxAttempts={3}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    // The counter lives in its own slot inside the pill, so the label never
    // renders "Tentative 33/3".
    expect(screen.queryByText("Tentative 3/3")).not.toBeInTheDocument();
    expect(screen.getByTestId("queue-status")).toHaveAccessibleName("Tentative 3/3");
    expect(screen.getByTestId("queue-status")).toHaveAttribute("data-weight", "loud");
  });

  describe("end-call affordance per status", () => {
    it("shows End call for a brand-new order with no note", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "pending", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(screen.getAllByRole("button", { name: /appel terminé/i }).length).toBeGreaterThan(0);
    });

    it("shows End call for an assigned order with no note", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "assigned", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(screen.getAllByRole("button", { name: /appel terminé/i }).length).toBeGreaterThan(0);
    });

    it("does NOT show End call for a normal uploaded order (carrier-locked)", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "uploaded", customer_note: null, tracking_number: "TRK-1" }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(screen.queryByRole("button", { name: /appel terminé/i })).not.toBeInTheDocument();
    });

    it("shows End call for an uploaded order whose reference was deleted", () => {
      render(
        <OrderCard
          order={{
            ...mockOrder,
            status: "uploaded",
            customer_note: null,
            tracking_number: null,
            carrier_barcode_deleted_at: "2026-05-20T10:00:00Z",
          }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(screen.getAllByRole("button", { name: /appel terminé/i }).length).toBeGreaterThan(0);
    });

    it("does NOT show End call for a rejected order", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "rejected", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(screen.queryByRole("button", { name: /appel terminé/i })).not.toBeInTheDocument();
    });
  });

  describe("status sign + phone prominence", () => {
    it("renders a visible status sign for a new order", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "pending", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(screen.getByText("En attente")).toBeInTheDocument();
    });

  });

  describe("status rail", () => {
    // The leading-edge rail takes the row's own status hue, so the rail and the
    // pill can never disagree — they read the same presentation map.
    const railHue = () =>
      (document.querySelector("[data-order-id='order-1'] span[aria-hidden='true']") as HTMLElement)
        .className;

    it.each([
      ["pending", "hue-neutral-edge"],
      ["attempt_1", "hue-amber-edge"],
      ["confirmed", "hue-violet-edge"],
      ["uploaded", "hue-teal-edge"],
      ["delivered", "hue-green-edge"],
      ["rejected", "hue-red-edge"],
    ])("%s → %s", (status, expected) => {
      render(
        <OrderCard
          order={{ ...mockOrder, status, customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(railHue()).toContain(expected);
    });
  });

  describe("deleted-anchor badge guard", () => {
    it("hides both the repeat-buyer and duplicate badges when the order is deleted", () => {
      const { container } = render(
        <OrderCard
          order={{
            ...mockOrder,
            status: "deleted",
            repeat_kind: "repeat",
            prior_order_count: 3,
            is_potential_duplicate: true,
            is_duplicate_anchor: true,
            duplicate_count: 1,
            duplicate_siblings: [
              {
                id: "sibling-1",
                external_id: "3048",
                status: "confirmed",
                created_at: "2026-04-10T11:00:00Z",
                product_name: "T-Shirt Premium",
                product_image_url: null,
                quantity: 1,
                total_price: 89.9,
                customer_name: "Ahmed Gharbi",
                customer_address: null,
                customer_city: "Tunis",
                already_shipped: false,
              },
            ],
          }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
        />,
      );
      expect(container.querySelector('[data-duplicate="true"]')).toBeNull();
      expect(container.querySelector("[data-repeat-kind]")).toBeNull();
    });
  });
});
