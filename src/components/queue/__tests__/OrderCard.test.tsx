import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrderCard } from "../OrderCard";
import type { QueueOrder } from "@/types/queue";
import { formatLongDate, formatTime } from "@/lib/format";

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
  repeat_kind: "none",
  prior_order_count: 0,
  prior_lead_count: 0,
  prior_rejected_count: 0,
  last_known_address: null,
  rejection_reason: null,
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

  it("renders the creation date and time together, separated by a comma", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    const longDate = formatLongDate(mockOrder.created_at, "fr");
    const time = formatTime(mockOrder.created_at, "fr");
    expect(
      screen.getByText((content) => content.includes(longDate) && content.includes(`, ${time}`)),
    ).toBeDefined();
  });

  it("renders the price after the status sign (trailing edge of the card)", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    const price = screen.getByText("89.9");
    // Status renders twice (compact mobile sub-row + desktop trailing column);
    // assert against the desktop instance, which is the last in DOM order.
    const status = screen.getAllByText("Assigné").at(-1)!;
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

  it("shows customer note when present", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("Livrer avant midi")).toBeDefined();
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

  it("uses a darker border for normal orders", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
    expect(card.className).toContain("border-black/35");
  });

  it("shows the created date and time as a single line without an elapsed sub-line", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-02T10:00:00Z").getTime());
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    // The standalone elapsed value ("22j") was removed for a calmer, date-only column.
    expect(screen.queryByText("22j")).toBeNull();
    const longDate = formatLongDate(mockOrder.created_at, "fr");
    const time = formatTime(mockOrder.created_at, "fr");
    expect(
      screen.getByText((content) => content.includes(longDate) && content.includes(`, ${time}`)),
    ).toBeDefined();
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
    const pill = screen.getAllByText("Téléchargé").at(-1)!;
    expect(pill.className).toContain("text-[#7C3AED]");
    expect(pill.className).toContain("bg-[#F3E8FF]");
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
    const pill = screen.getAllByText("En cours").at(-1)!;
    expect(pill.className).toContain("text-[#0891B2]");
  });

  it("renders rejected status with critical tone", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, status: "rejected", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    const pill = screen.getAllByText("Rejeté").at(-1)!;
    expect(pill.className).toContain("text-status-critical");
  });

  it("reveals the rejection reason on hover over a rejected pill", async () => {
    const user = userEvent.setup();
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "rejected",
          customer_note: null,
          rejection_reason: "refus_client",
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    // Reason is not shown until hover
    expect(screen.queryByText("Refus client")).not.toBeInTheDocument();
    await user.hover(screen.getAllByText("Rejeté").at(-1)!);
    expect(await screen.findByText("Refus client")).toBeInTheDocument();
  });

  it("appends the free-text note for the 'autre' rejection reason on hover", async () => {
    const user = userEvent.setup();
    render(
      <OrderCard
        order={{
          ...mockOrder,
          status: "rejected",
          customer_note: null,
          rejection_reason: "autre",
          rejection_note: "Client injoignable depuis 3 jours",
        }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    await user.hover(screen.getAllByText("Rejeté").at(-1)!);
    expect(
      await screen.findByText(/Client injoignable depuis 3 jours/),
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
    // Etiquette renders twice (compact mobile "4/5" + full desktop label);
    // both expose the same accessible name.
    expect(screen.getAllByRole("note", { name: /Tentative 4/ }).length).toBeGreaterThan(0);
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
    // The status pill already conveys the final attempt ("Tentative 3 (final)");
    // the old supporting-row "Tentative 3/3" duplicate should be gone.
    expect(screen.queryByText("Tentative 3/3")).not.toBeInTheDocument();
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
      // The status label is present (rendered in both the compact mobile
      // sub-row and the desktop trailing column).
      const signs = screen.getAllByText("En attente");
      expect(signs.length).toBeGreaterThan(0);
    });

  });

  describe("bucket-driven border tone", () => {
    it("nouveau bucket → blue border", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "pending", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="nouveau"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#1E3A5F]");
    });

    it("en_cours bucket → amber border", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "attempt_1", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="en_cours"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#B07A00]");
    });

    it("confirme bucket → green border", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "confirmed", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="confirme"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#10B981]");
    });

    it("fermees + rejected → red border", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "rejected", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="fermees"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#DC2626]");
    });

    it("fermees + uploaded → purple border", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "uploaded", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="fermees"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#7C3AED]");
    });

    it("fermees + delivered → green border (matches Livré bucket pill)", () => {
      // Border tone follows the lifecycle bucket so the pill + frame match.
      render(
        <OrderCard
          order={{ ...mockOrder, status: "delivered", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="fermees"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#10B981]");
    });

    it("fermees + dispatched → cyan border (En cours bucket)", () => {
      // bucketFor() maps dispatched → 'deposit' → cyan, both on the pill and border.
      render(
        <OrderCard
          order={{ ...mockOrder, status: "dispatched", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="fermees"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#0891B2]");
    });
  });
});
