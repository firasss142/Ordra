import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrderCard } from "../OrderCard";
import type { QueueOrder } from "@/types/queue";

const intlMockState = vi.hoisted(() => ({ locale: "fr" }));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => intlMockState.locale,
  };
});

afterEach(() => vi.restoreAllMocks());

const NOW = new Date("2026-04-10T20:00:00Z");

const order = (over: Partial<QueueOrder> = {}): QueueOrder =>
  ({
    id: "o1",
    customer_name: "Ahmed Gharbi",
    customer_phone: "22123456",
    customer_address: null,
    customer_city: "Tunis",
    product_name: "T-Shirt Premium",
    product_display_name: "T-Shirt Premium",
    variant_label: "",
    quantity: 1,
    product_image_url: null,
    carrier_id: null,
    carrier_code: null,
    carrier_name: null,
    total_price: 89.9,
    currency: "TND",
    market_id: "m1",
    attempt_count: 0,
    callback_time: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    customer_note: null,
    customer_phone_2: null,
    status: "pending",
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
    ...over,
  }) as QueueOrder;

function renderRow(over: Partial<QueueOrder> = {}, props: Record<string, unknown> = {}) {
  vi.setSystemTime(NOW);
  return render(
    <OrderCard
      order={order(over)}
      onOpenDetail={() => {}}
      onCallTerminated={() => {}}
      maxAttempts={8}
      {...props}
    />,
  );
}

describe("OrderCard — the activity cell", () => {
  it("counts the attempts against the configured maximum", () => {
    renderRow({ attempt_count: 2, status: "attempt_2" });
    expect(screen.getByTestId("order-attempts").textContent).toBe("2 / 8");
  });

  it("starts at zero rather than hiding the counter on an untouched order", () => {
    renderRow();
    expect(screen.getByTestId("order-attempts").textContent).toBe("0 / 8");
  });

  it("says nobody has called yet when no agent has acted", () => {
    renderRow();
    expect(screen.getByTestId("order-activity").textContent).toContain("Pas encore appelé");
  });

  it("says how long ago the last call was once one has happened", () => {
    renderRow({
      attempt_count: 1,
      status: "attempt_1",
      last_action_at: "2026-04-10T17:00:00Z",
    });
    const cell = screen.getByTestId("order-activity").textContent ?? "";
    expect(cell).toContain("3h");
    expect(cell).not.toContain("Pas encore appelé");
  });
});

describe("OrderCard — the age gauge", () => {
  it("states the elapsed time in the age cell", () => {
    renderRow();
    expect(screen.getByTestId("order-age").textContent).toContain("10h");
  });

  it("draws a bar whose width is the share of a day the order has waited", () => {
    renderRow();
    // 10h of a 24h ceiling.
    expect(screen.getByTestId("order-age-gauge")).toHaveStyle({ width: "42%" });
  });

  it("fills the bar rather than overflowing it on a very old order", () => {
    renderRow({ created_at: "2026-04-01T10:00:00Z" });
    expect(screen.getByTestId("order-age-gauge")).toHaveStyle({ width: "100%" });
  });

  it("carries the same tier as the age text, so colour and number agree", () => {
    renderRow({ created_at: "2026-04-01T10:00:00Z" });
    expect(screen.getByTestId("order-age")).toHaveAttribute("data-tier", "late");
    expect(screen.getByTestId("order-age-gauge")).toHaveAttribute("data-tier", "late");
  });
});

describe("OrderCard — what the bucket already says, the row does not repeat", () => {
  it("carries no status tag: the bucket chips above the list name the status", () => {
    renderRow();
    expect(screen.queryByTestId("queue-status")).not.toBeInTheDocument();
  });

  it("keeps the two clocks out of the row — age is the only time column", () => {
    renderRow();
    expect(screen.queryByTestId("order-last-action")).not.toBeInTheDocument();
    expect(screen.queryByTestId("order-clocks")).not.toBeInTheDocument();
  });
});

describe("OrderCard — the call button", () => {
  it("offers a call button on the row", () => {
    renderRow();
    expect(screen.getByTestId("row-call")).toBeInTheDocument();
  });

  it("records the call outcome instead of opening the panel", async () => {
    const onOpenDetail = vi.fn();
    const onCallTerminated = vi.fn();
    renderRow({}, { onOpenDetail, onCallTerminated });

    await userEvent.click(screen.getByTestId("row-call"));

    expect(onCallTerminated).toHaveBeenCalledWith("o1");
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("still opens the panel when the row itself is clicked", async () => {
    const onOpenDetail = vi.fn();
    renderRow({}, { onOpenDetail });

    await userEvent.click(screen.getByText("Ahmed Gharbi"));

    expect(onOpenDetail).toHaveBeenCalledWith("o1");
  });

  it("is hidden on a carrier-locked order, which no longer takes a call", () => {
    renderRow({ status: "uploaded" });
    expect(screen.queryByTestId("row-call")).not.toBeInTheDocument();
  });
});
