import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { WorklistRow } from "@/lib/delivery/types";

vi.mock("@/hooks/useDeliveryTimeline", () => ({
  useDeliveryTimeline: () => ({ timeline: [], isLoading: false, error: null }),
}));

import { DeliveryDetailScreen } from "../DeliveryDetail";

const NOW = Date.parse("2026-09-16T10:30:00Z");

function row(over: Partial<WorklistRow> = {}): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "at_carrier", bucket: "act_now",
    reason_codes: ["stalled:5"], hours_on_status: 20, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 199, customer_name: "عمران السعيطي", customer_phone: "0944911762", customer_phone_2: null,
    customer_city: "بنغازي", customer_address: "النواقية", assigned_to: "a1", agent_name: "salima",
    tracking_number: "2162290", carrier_id: "c1", carrier_status_slug: "at_carrier",
    latest_remark: "خارج التغطيه", latest_remark_at: "2026-09-16T06:00:00Z", remark_class: "out_of_coverage",
    delayed_until: null, resend_count: 0,
    handler_name: "Mahdi (الميلا) Storage", handler_phone: "0945124165",
    handler_account_name: null, handler_account_phone: null,
    to_branch_group: "BN", latest_event_at: "2026-09-16T06:00:00Z",
    customer_orders_count: 1, customer_delivered_count: 0, customer_returned_count: 0, customer_rejected_count: 0,
    customer_risk_class: "none", last_action_at: null, last_action_type: null, last_action_outcome: null,
    last_action_note: null, has_open_task: false, terminal_at: null, created_at: "2026-09-16T01:45:00Z",
    carrier_name: "Darb Assabil - Tripoli", items: [],
    ...over,
  };
}

function mount(over: Partial<WorklistRow> = {}) {
  const onDialed = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli" now={new Date(NOW)}>
      <DeliveryDetailScreen
        row={row(over)} market="ly" locale="fr" tz="Africa/Tripoli" now={NOW}
        onBack={vi.fn()} onLogAction={vi.fn()} onWhatsApp={vi.fn()} onDialed={onDialed} onQuick={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return { onDialed };
}

/** The "Informations livraison" block, addressed by its heading. */
const deliveryBlock = () => screen.getByRole("heading", { name: "Informations livraison" }).parentElement as HTMLElement;

describe("the phone screen carries what the desktop panel carries", () => {
  it("shows the courier's phone number, not just their name", () => {
    mount();
    const block = within(deliveryBlock());
    expect(block.getByText("Mahdi (الميلا) Storage")).toBeInTheDocument();
    expect(block.getByText("094 512 4165")).toBeInTheDocument();
  });

  it("makes that number dialable, because on a phone the number is the action", () => {
    const { onDialed } = mount();
    const link = within(deliveryBlock()).getByRole("link", { name: /094 512 4165/ });
    expect(link).toHaveAttribute("href", "tel:0945124165");
    link.click();
    expect(onDialed).toHaveBeenCalled();
  });

  it("shows the courier's own remark, which says why the parcel is stuck", () => {
    mount();
    expect(within(deliveryBlock()).getByText(/خارج التغطيه/)).toBeInTheDocument();
  });

  it("offers to call the courier when there is one to call", () => {
    mount();
    expect(within(deliveryBlock()).getByRole("link", { name: "Appeler le livreur" })).toHaveAttribute("href", "tel:0945124165");
  });

  it("falls back to the account's number when the parcel has no named courier", () => {
    mount({ handler_name: null, handler_phone: null, handler_account_phone: "0912345678" });
    expect(within(deliveryBlock()).getByRole("link", { name: "Appeler le livreur" })).toHaveAttribute("href", "tel:0912345678");
  });

  it("says the parcel is not yet with the carrier instead of showing three dashes", () => {
    mount({ carrier_name: null, handler_name: null, handler_phone: null, handler_account_phone: null, latest_remark: null });
    const block = within(deliveryBlock());
    expect(block.getByText("Pas encore remis au transporteur")).toBeInTheDocument();
    expect(block.queryByRole("link", { name: "Appeler le livreur" })).not.toBeInTheDocument();
  });

  it("does not offer a courier call on a finished parcel", () => {
    mount({ bucket: "done", status: "delivered", reason_codes: [], terminal_at: "2026-09-16T09:00:00Z" });
    expect(within(deliveryBlock()).queryByRole("link", { name: "Appeler le livreur" })).not.toBeInTheDocument();
  });

  it("still shows the customer's own numbers", () => {
    mount();
    const client = within(screen.getByRole("heading", { name: "Informations client" }).parentElement as HTMLElement);
    expect(client.getByRole("link", { name: /094 491 1762/ })).toHaveAttribute("href", "tel:0944911762");
  });
});
