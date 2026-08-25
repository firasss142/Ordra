import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReturnCard } from "../ReturnCard";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

/**
 * One returned parcel (mockup 04).
 *
 * The desk console kept the decision in a side panel; on a phone that panel
 * sits a screen away from the parcel it describes. The three decisions are on
 * the card, and the stepper says where this parcel is — not where the console
 * is.
 */
const row = (over: Partial<WarehouseOrderRow> = {}) =>
  ({
    id: "aaaaaaaa-1111-2222-3333-444444444444",
    customer_name: "Mouna Zouaghi",
    customer_phone: "216",
    customer_city: "Tunis",
    customer_area: null,
    customer_address: null,
    uploaded_at: null,
    branch_group: null,
    product_id: "p1",
    product_name: "Biovera - Routine Anti-Cellulite",
    variant_label: null,
    quantity: 2,
    total_price: 49,
    status: "to_be_returned",
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    tracking_number: "000000221137",
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    has_carrier_ref: null,
    current_stock: null,
    low_stock_threshold: null,
    returned_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    ...over,
  }) as WarehouseOrderRow;

const props = {
  row: row(),
  picked: false,
  decision: null as null | "restock" | "damage" | "redeliver",
  busy: false,
  currency: "TND",
  onPick: vi.fn(),
  onDecide: vi.fn(),
};

afterEach(cleanup);

describe("ReturnCard", () => {
  it("leads with the reference printed on the parcel", () => {
    render(<ReturnCard {...props} />);
    expect(screen.getByTestId("wm-return-ref").textContent).toContain("000000221137");
  });

  it("names the product and how many came back", () => {
    render(<ReturnCard {...props} />);
    expect(screen.getByText(/Biovera/)).toBeInTheDocument();
    expect(screen.getByTestId("wm-return-qty").textContent).toContain("2");
  });

  it("offers the three decisions the system actually supports", () => {
    render(<ReturnCard {...props} />);
    for (const name of [/remettre en stock/i, /endommagé/i, /rélivrer/i]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("walks the stepper as the parcel moves, not as the console moves", () => {
    const { rerender } = render(<ReturnCard {...props} />);
    expect(screen.getByTestId("wm-step").dataset.step).toBe("1");
    rerender(<ReturnCard {...props} picked />);
    expect(screen.getByTestId("wm-step").dataset.step).toBe("2");
    rerender(<ReturnCard {...props} picked decision="restock" />);
    expect(screen.getByTestId("wm-step").dataset.step).toBe("3");
  });

  it("picks the parcel when a decision is tapped on an untouched card", () => {
    // The agent has the parcel in hand; making them tap "select" first is a
    // step that exists only because the desk console had a side panel.
    const onPick = vi.fn();
    const onDecide = vi.fn();
    render(<ReturnCard {...props} onPick={onPick} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /remettre en stock/i }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: props.row.id }));
    expect(onDecide).toHaveBeenCalledWith("restock");
  });

  it("marks the chosen decision so a mis-tap is visible before validating", () => {
    render(<ReturnCard {...props} picked decision="damage" />);
    expect(screen.getByRole("button", { name: /endommagé/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows how long the parcel has been waiting", () => {
    render(<ReturnCard {...props} />);
    expect(screen.getByTestId("wm-return-age").textContent).toMatch(/3 j/);
  });

  it("locks every decision while a submission is in flight", () => {
    render(<ReturnCard {...props} picked decision="restock" busy />);
    expect(screen.getByRole("button", { name: /rélivrer/i })).toBeDisabled();
  });
});
