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
  carrier_accent_color: null,
  carrier_account_label: null,
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

  it("names each account of the same carrier with a solid pill in its colour", () => {
    // Libya runs two Darb Assabil accounts under one code, so both resolve to
    // the same logo file. A thin ring around it was not readable (owner,
    // 2026-10-03): the account now carries its city, in its own colour.
    const base = { ...mockOrder, carrier_code: "darb_assabil", status: "uploaded", customer_note: null };
    render(
      <OrderCard
        order={{ ...base, carrier_id: "4f1271c8-b1f2-4836-9293-8ab3d0b18e69", carrier_name: "Darb Assabil - Tripoli",
          carrier_accent_color: "#1F5FBF", carrier_account_label: { fr: "Tripoli", ar: "طرابلس" } }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    render(
      <OrderCard
        order={{ ...base, carrier_id: "43077d36-3d61-40d6-ae35-59ed15cec8f7", carrier_name: "Darb Assabil — Benghazi",
          carrier_accent_color: "#C24E17", carrier_account_label: { fr: "Benghazi", ar: "بنغازي" } }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("Tripoli")).toHaveStyle({ backgroundColor: "#1F5FBF" });
    expect(screen.getByText("Benghazi")).toHaveStyle({ backgroundColor: "#C24E17" });
  });

  it("writes the account's city in the agent's language", () => {
    intlMockState.locale = "ar";
    render(
      <OrderCard
        order={{ ...mockOrder, carrier_code: "darb_assabil", carrier_id: "4f1271c8-b1f2-4836-9293-8ab3d0b18e69",
          carrier_name: "Darb Assabil - Tripoli", carrier_accent_color: "#1F5FBF", carrier_account_label: { fr: "Tripoli", ar: "طرابلس" },
          status: "uploaded", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByText("طرابلس")).toBeDefined();
  });

  it("keeps the brand logo and the account name readable without colour", () => {
    render(
      <OrderCard
        order={{
          ...mockOrder,
          carrier_code: "darb_assabil",
          carrier_id: "43077d36-3d61-40d6-ae35-59ed15cec8f7",
          carrier_name: "Darb Assabil — Benghazi",
          carrier_accent_color: "#C24E17",
          carrier_account_label: { fr: "Benghazi", ar: "بنغازي" },
          status: "uploaded",
          customer_note: null,
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.getByAltText("Darb Assabil — Benghazi")).toBeDefined();
    expect(screen.getByText("Benghazi")).toBeDefined();
  });

  it("gives no city pill to a carrier that runs a single account", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, carrier_code: "navex", carrier_id: "n-1", carrier_name: "Navex", status: "uploaded", customer_note: null,
          carrier_accent_color: "#1F5FBF", carrier_account_label: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    expect(screen.queryByTestId("carrier-account-pill")).toBeNull();
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

  it("calls onCallTerminated when the row's call button is clicked", async () => {
    const user = userEvent.setup();
    const onCallTerminated = vi.fn();
    render(
      <OrderCard
        order={mockOrder}
        onOpenDetail={() => {}}
        onCallTerminated={onCallTerminated}
      />
    );
    // One instance, phone-only: the desktop row opens the panel instead.
    const button = screen.getByRole("button", { name: /appel terminé/i });
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

  // Rev 3 (2026-09-19): the call affordance is back on the row as a glyph, on
  // phones only — the desktop row opens the panel and the outcome is recorded
  // there. These rules say which statuses still have a call to record at all.
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

/**
 * Revision 2 (2026-09-18) — the owner's rework of the row: product first, a
 * flat status tag with an icon, two clocks, and no action button on desktop.
 */
describe("OrderCard — product-first row", () => {
  it("still opens the detail panel when the row is clicked", async () => {
    const onOpenDetail = vi.fn();
    render(
      <OrderCard order={mockOrder} onOpenDetail={onOpenDetail} onCallTerminated={() => {}} />,
    );
    await userEvent.click(screen.getByText("Ahmed Gharbi"));
    expect(onOpenDetail).toHaveBeenCalledWith("order-1");
  });

});

describe("OrderCard — WhatsApp line (prototype whatsapp-agent-v1.html, queue row)", () => {
  it("marks a row with a WhatsApp conversation before the product", () => {
    render(<OrderCard order={{ ...mockOrder, wa_conversation: true, wa_unread: 0 }} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    const mark = screen.getByTestId("queue-row-whatsapp");
    expect(mark).toHaveTextContent("WhatsApp");
    expect(mark.querySelector('[data-icon="whatsapp"]')).not.toBeNull();
  });

  it("says « a répondu » while a reply is unread", () => {
    render(<OrderCard order={{ ...mockOrder, wa_conversation: true, wa_unread: 1 }} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByTestId("queue-row-whatsapp")).toHaveTextContent("a répondu");
  });

  it("no conversation, no mark", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.queryByTestId("queue-row-whatsapp")).toBeNull();
  });
});

describe("OrderCard — an open complaint on the row (Voix du client)", () => {
  it("prints « 1 réclamation ouverte » before the product, in red", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={vi.fn()} onCallTerminated={vi.fn()} openComplaints={1} />);
    // This file's next-intl mock does not render ICU plurals; the real provider's « 1 réclamation
    // ouverte » is asserted in PanelFeedbackButton.test.tsx.
    const flag = screen.getByText(/réclamation ouverte/);
    expect(flag.className).toContain("text-[#991B1B]");
  });

  it("says nothing when the customer has none", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={vi.fn()} onCallTerminated={vi.fn()} />);
    expect(screen.queryByText(/réclamation ouverte/)).toBeNull();
  });
});
