import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { QueueStatusPill } from "../QueueStatusPill";
import type { QueueOrder } from "@/types/queue";

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

function order(over: Partial<QueueOrder> = {}): QueueOrder {
  return {
    id: "o-1",
    status: "pending",
    customer_name: "Ahmed Gharbi",
    customer_phone: "22123456",
    customer_address: null,
    customer_city: "Tunis",
    product_name: "T-Shirt",
    variant_label: "L",
    quantity: 1,
    product_image_url: null,
    carrier_id: null,
    carrier_code: null,
    carrier_name: null,
    total_price: 89.9,
    currency: "TND",
    market_id: null,
    attempt_count: 0,
    callback_time: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    customer_note: null,
    customer_phone_2: null,
    created_at: "2026-08-01T10:00:00Z",
    assigned_at: "2026-08-01T10:00:00Z",
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
  };
}

describe("QueueStatusPill", () => {
  it("names the status in words, never colour alone", () => {
    render(<QueueStatusPill order={order({ status: "pending" })} />);
    expect(screen.getByText("En attente")).toBeInTheDocument();
  });

  it("always renders a glyph beside the label, so the state survives greyscale", () => {
    const { container } = render(<QueueStatusPill order={order({ status: "pending" })} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("exposes hue and weight for the column to be scanned by", () => {
    render(<QueueStatusPill order={order({ status: "confirmed" })} />);
    const pill = screen.getByTestId("queue-status");
    expect(pill).toHaveAttribute("data-hue", "violet");
    expect(pill).toHaveAttribute("data-weight", "medium");
  });

  it("renders the attempt counter from attempt_count against the market ceiling", () => {
    render(
      <QueueStatusPill
        order={order({ status: "attempt_3", attempt_count: 5 })}
        maxAttempts={8}
      />,
    );
    expect(screen.getByText("5/8")).toBeInTheDocument();
  });

  it("does not repeat the trailing digit already in the status label", () => {
    // "Tentative 3" + a "5/8" counter would read "Tentative 35/8".
    render(
      <QueueStatusPill
        order={order({ status: "attempt_3", attempt_count: 5 })}
        maxAttempts={8}
      />,
    );
    expect(screen.queryByText(/Tentative\s*3\s*$/)).toBeNull();
    expect(screen.getByTestId("queue-status").textContent).not.toMatch(/35\/8/);
  });

  it("goes loud when attempts are exhausted", () => {
    render(
      <QueueStatusPill
        order={order({ status: "attempt_3", attempt_count: 8 })}
        maxAttempts={8}
      />,
    );
    expect(screen.getByTestId("queue-status")).toHaveAttribute("data-weight", "loud");
  });

  it("shows a scheduled callback's clock time as the datum", () => {
    render(
      <QueueStatusPill
        order={order({ status: "callback_scheduled", callback_time: "2026-08-09T17:30:00Z" })}
        now={new Date("2026-08-07T12:00:00Z")}
      />,
    );
    const pill = screen.getByTestId("queue-status");
    expect(pill).toHaveAttribute("data-hue", "violet");
    expect(pill.textContent).toMatch(/\d{1,2}[:h]\d{2}/);
  });

  it("replaces an overdue callback's time with a word and turns the pill red", () => {
    render(
      <QueueStatusPill
        order={order({ status: "callback_scheduled", callback_time: "2026-08-07T09:00:00Z" })}
        now={new Date("2026-08-07T12:00:00Z")}
      />,
    );
    const pill = screen.getByTestId("queue-status");
    expect(pill).toHaveAttribute("data-hue", "red");
    expect(pill).toHaveAttribute("data-weight", "loud");
    expect(screen.getByText("En retard")).toBeInTheDocument();
  });

  it("resolves the reference-deleted label instead of leaking a raw i18n key", () => {
    render(
      <QueueStatusPill
        order={order({
          status: "uploaded",
          tracking_number: null,
          carrier_barcode_deleted_at: "2026-08-05T10:00:00Z",
        })}
      />,
    );
    expect(screen.getByText("À réuploader")).toBeInTheDocument();
    expect(screen.queryByText(/statusReferenceDeleted/)).toBeNull();
  });

  it("folds the datum into one accessible name rather than two fragments", () => {
    render(
      <QueueStatusPill
        order={order({ status: "attempt_1", attempt_count: 1 })}
        maxAttempts={8}
      />,
    );
    expect(screen.getByTestId("queue-status")).toHaveAccessibleName("Tentative 1/8");
  });
});
