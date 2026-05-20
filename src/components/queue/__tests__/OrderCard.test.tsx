import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrderCard } from "../OrderCard";
import type { QueueOrder } from "@/types/queue";
import { formatDateTime } from "@/lib/format";

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
  total_price: 89.9,
  currency: "TND",
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
};

describe("OrderCard", () => {
  it("renders customer name and phone", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("Ahmed Gharbi")).toBeDefined();
    expect(screen.getByText("22123456")).toBeDefined();
  });

  it("renders product name and variant", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText(/T-Shirt Premium/)).toBeDefined();
    expect(screen.getByText(/L \/ Rouge/)).toBeDefined();
  });

  it("renders total price and currency", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("89.9")).toBeDefined();
    expect(screen.getByText("TND")).toBeDefined();
  });

  it("renders city", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText("Tunis")).toBeDefined();
  });

  it("renders the formatted creation date/time", () => {
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(screen.getByText(formatDateTime(mockOrder.created_at, "fr"))).toBeDefined();
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
    const button = screen.getByRole("button", { name: /appel terminé/i });
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

  it("localizes elapsed days in Arabic", () => {
    intlMockState.locale = "ar";
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-02T10:00:00Z").getTime());
    render(<OrderCard order={mockOrder} onOpenDetail={() => {}} onCallTerminated={() => {}} />);
    expect(
      screen.getByText((content) => content.includes("منذ") && content.includes("يوم")),
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
    const pill = screen.getByText("Téléchargé");
    expect(pill.className).toContain("text-[#7C3AED]");
    expect(pill.className).toContain("border-[#7C3AED]/25");
  });

  it("renders dispatched status with success tone", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, status: "dispatched", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    const pill = screen.getByText("Expédié");
    expect(pill.className).toContain("text-status-success");
  });

  it("renders rejected status with critical tone", () => {
    render(
      <OrderCard
        order={{ ...mockOrder, status: "rejected", customer_note: null }}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
      />,
    );
    const pill = screen.getByText("Rejeté");
    expect(pill.className).toContain("text-status-critical");
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
    expect(screen.getByRole("note", { name: /Tentative 4/ })).toBeInTheDocument();
    expect(screen.queryByText(/final/)).not.toBeInTheDocument();
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

    it("fermees + delivered → gold border", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "delivered", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="fermees"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-[#D97706]");
    });

    it("fermees + other status → neutral archive border", () => {
      render(
        <OrderCard
          order={{ ...mockOrder, status: "dispatched", customer_note: null }}
          onOpenDetail={() => {}}
          onCallTerminated={() => {}}
          selectedBucket="fermees"
        />,
      );
      const card = document.querySelector("[data-order-id='order-1']") as HTMLElement;
      expect(card.className).toContain("border-agent-outline");
    });
  });
});
