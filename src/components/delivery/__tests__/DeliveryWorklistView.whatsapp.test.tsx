import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { WorklistRow } from "@/lib/delivery/types";

vi.mock("@/hooks/useDeliveryTimeline", () => ({
  useDeliveryTimeline: () => ({ timeline: [], isLoading: false, error: null }),
}));

// The live sheet and the thread section have their own suites; here they
// are stand-ins so the view's own wiring is what is under test.
vi.mock("../WhatsAppLiveSheet", () => ({
  WhatsAppLiveSheet: ({ onSent, onClose }: { onSent: (b: Record<string, unknown>) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="live-sheet">
      <button onClick={() => onSent({ action_type: "whatsapp_customer", outcome: "sent", note: null, next_action_at: null, template_key: "before_delivery", alreadyRecorded: true })}>live-send</button>
      <button onClick={onClose}>live-close</button>
    </div>
  ),
}));
vi.mock("../DeliveryMessages", () => ({ DeliveryMessages: () => null }));

import { DeliveryWorklistView, type DeliveryWorklistViewProps } from "../DeliveryWorklistView";

// 10:30 UTC = 12:30 in Tripoli.
const NOW = Date.parse("2026-09-13T10:30:00Z");

function row(over: Partial<WorklistRow>): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "out_for_delivery", bucket: "act_now",
    reason_codes: ["remark:no_answer"], hours_on_status: 5, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 185, customer_name: "Amina El Fitouri", customer_phone: "0914456677", customer_phone_2: "0921122334",
    customer_city: "Tripoli", customer_address: "Aïn Zara", assigned_to: "agent-1", agent_name: "Hend",
    tracking_number: "5501", carrier_id: "c1", carrier_status_slug: "out_for_delivery", latest_remark: "الزبون لم يرد ع التلفون",
    latest_remark_at: "2026-09-13T07:12:00Z", remark_class: "no_answer", delayed_until: null, resend_count: 0,
    handler_name: "Ali Ben Omar", handler_phone: "0912345678", handler_account_name: null, handler_account_phone: null,
    to_branch_group: null, latest_event_at: "2026-09-13T07:12:00Z", customer_orders_count: 2, customer_delivered_count: 1,
    customer_returned_count: 0, customer_rejected_count: 0, customer_risk_class: "repeat",
    last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
    has_open_task: false, terminal_at: null, created_at: "2026-09-12T08:00:00Z", carrier_name: "Darb Assabil",
    items: [{ product_name: "Sérum vitamine C", variant_label: null, quantity: 1, image_url: "https://cdn/serum.jpg" }],
    ...over,
  };
}

const AMINA = row({});
const HUDA = row({
  order_id: "o2", external_id: "48172", status: "returning", bucket: "returning", reason_codes: ["returning"],
  customer_name: "Huda Al-Mabrouk", customer_phone: "0923341122", customer_phone_2: null, total_price: 95,
  remark_class: "no_answer", handler_account_phone: "0917710099",
  items: [{ product_name: "Crème hydratante", variant_label: null, quantity: 1, image_url: null }],
});
const TAREK = row({
  order_id: "o3", external_id: "48145", status: "delivered", bucket: "done", reason_codes: [],
  customer_name: "Tarek Ben Salem", customer_phone: "0926617788", customer_phone_2: null, total_price: 90,
  remark_class: null, latest_remark: null, terminal_at: "2026-09-13T10:05:00Z",
});

function mount(over: Partial<DeliveryWorklistViewProps> = {}) {
  const props: DeliveryWorklistViewProps = {
    rows: [HUDA, AMINA, TAREK],
    error: false,
    onRetry: vi.fn(),
    scorecard: { delivered: 7, returned: 2, delivery_rate: 78, saved: 1, window_days: 30 },
    role: "agent",
    marketCode: "ly",
    tz: "Africa/Tripoli",
    locale: "fr",
    now: NOW,
    pending: null,
    notice: null,
    onQueue: vi.fn(),
    onUndo: vi.fn(),
    onDismissNotice: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <DeliveryWorklistView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const list = () => screen.getByRole("list", { name: "Suivi livraison" });
const rowOf = (name: string) => within(list()).getByText(name).closest("[role='listitem']") as HTMLElement;

beforeEach(() => vi.clearAllMocks());

const openWhatsApp = () => {
  fireEvent.click(within(rowOf("Amina El Fitouri")).getByText("Amina El Fitouri"));
  fireEvent.click(within(screen.getByRole("region", { name: "Détail du colis" })).getByRole("button", { name: "WhatsApp" }));
};

describe("DeliveryWorklistView — WhatsApp (prototype whatsapp-agent-v1.html, screen `delivery`)", () => {
  it("connected: a real send records the action and the sheet STAYS open on its « Envoyé » state", () => {
    const props = mount({ marketId: "00000000-0000-0000-0000-000000000002", whatsappActive: true, whatsappKnown: true });
    openWhatsApp();
    fireEvent.click(screen.getByText("live-send"));
    expect(props.onQueue).toHaveBeenCalledWith(expect.objectContaining({ order_id: "o1" }), expect.objectContaining({ alreadyRecorded: true }));
    expect(screen.getByRole("dialog", { name: "live-sheet" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("live-close"));
    expect(screen.queryByRole("dialog", { name: "live-sheet" })).not.toBeInTheDocument();
  });

  it("not connected: the wa.me sheet says so first, and its link is the outline « Ouvrir WhatsApp »", () => {
    const props = mount({ marketId: "00000000-0000-0000-0000-000000000002", whatsappActive: false, whatsappKnown: true });
    openWhatsApp();
    const sheet = screen.getByRole("dialog", { name: "Envoyer sur WhatsApp" });
    expect(within(sheet).getByText("WhatsApp n'est pas connecté pour ce marché")).toBeInTheDocument();
    expect(within(sheet).getByText(/En attendant, le lien wa\.me ouvre WhatsApp sur votre téléphone/)).toBeInTheDocument();
    const open = within(sheet).getByRole("link", { name: "Ouvrir WhatsApp" });
    expect(open).toHaveAttribute("data-variant", "outline");
    fireEvent.click(open);
    expect(props.onQueue).toHaveBeenCalledWith(expect.objectContaining({ order_id: "o1" }), expect.objectContaining({ action_type: "whatsapp_customer", outcome: "sent" }));
  });

  it("a parcel the business number wrote to since it last moved shows the WhatsApp trace with its live status", () => {
    const sent = row({ wa_last: { status: "read", at: "2026-09-13T10:31:00Z", template_key: "before_delivery" } });
    mount({ rows: [sent], marketId: "00000000-0000-0000-0000-000000000002", whatsappActive: true, whatsappKnown: true });
    const trace = within(rowOf("Amina El Fitouri")).getByTestId("row-wa-trace");
    expect(trace).toHaveTextContent("WhatsApp · Avant livraison · 12:31");
    expect(within(trace).getByLabelText("lu")).toBeInTheDocument();
  });

  it("a message older than the parcel's last movement leaves the usual clock line", () => {
    const old = row({ wa_last: { status: "read", at: "2026-09-12T06:00:00Z", template_key: "before_delivery" } });
    mount({ rows: [old], marketId: "00000000-0000-0000-0000-000000000002", whatsappActive: true, whatsappKnown: true });
    expect(within(rowOf("Amina El Fitouri")).queryByTestId("row-wa-trace")).toBeNull();
  });
});
