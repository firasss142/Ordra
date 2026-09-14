import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { WorklistRow } from "@/lib/delivery/types";

vi.mock("@/hooks/useDeliveryTimeline", () => ({
  useDeliveryTimeline: () => ({ timeline: [], isLoading: false, error: null }),
}));

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
    items: [{ product_name: "Sérum vitamine C", variant_label: null, quantity: 1 }],
    ...over,
  };
}

const AMINA = row({});
const HUDA = row({
  order_id: "o2", external_id: "48172", status: "returning", bucket: "returning", reason_codes: ["returning"],
  customer_name: "Huda Al-Mabrouk", customer_phone: "0923341122", customer_phone_2: null, total_price: 95,
  remark_class: "no_answer", handler_account_phone: "0917710099",
  items: [{ product_name: "Crème hydratante", variant_label: null, quantity: 1 }],
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

describe("DeliveryWorklistView", () => {
  it("shows the title, the parcels still in flight and the agent's 30-day pill", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Suivi livraison" })).toBeTruthy();
    expect(screen.getByText("2 en cours")).toBeTruthy();
    expect(screen.getByTestId("delivery-stat").textContent).toContain("78 %");
    expect(screen.getByTestId("delivery-stat").textContent).toContain("1 sauvées");
  });

  it("bucket cards count every bucket, show what it is worth, and narrow the list", () => {
    mount();
    const pills = screen.getByRole("group", { name: "Filtres" });
    const all = within(pills).getByRole("button", { name: /Tout\s*3/ });
    expect(all.textContent).toContain("370 LYD");
    expect(within(pills).getByRole("button", { name: /Retours à sauver\s*1/ }).textContent).toContain("95 LYD");
    fireEvent.click(within(pills).getByRole("button", { name: /Retours à sauver\s*1/ }));
    expect(within(list()).getByText("Huda Al-Mabrouk")).toBeTruthy();
    expect(within(list()).queryByText("Amina El Fitouri")).toBeNull();
  });

  it("search matches a name, a city or the digits of a phone", () => {
    mount();
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "112 2334" } });
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list()).getByText("Amina El Fitouri")).toBeTruthy();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("Rien ici")).toBeTruthy();
  });

  it("each row shows its situation and the one move that fits it", () => {
    mount();
    const amina = rowOf("Amina El Fitouri");
    expect(within(amina).getByText("Non joignable · 5 h")).toBeTruthy();
    expect(within(amina).getAllByRole("button", { name: "Appeler le 2ᵉ numéro" }).length).toBeGreaterThan(0);
    expect(within(rowOf("Huda Al-Mabrouk")).getByText("Retourné")).toBeTruthy();
    expect(within(rowOf("Tarek Ben Salem")).getByText("Livré")).toBeTruthy();
  });

  it("selecting a row fills the detail with the recommended move and the number to dial", () => {
    mount();
    fireEvent.click(within(rowOf("Amina El Fitouri")).getByText("Amina El Fitouri"));
    const panel = screen.getByRole("region", { name: "Détail du colis" });
    expect(within(panel).getByText("Prochaine action")).toBeTruthy();
    const call = within(panel).getByRole("link", { name: /Appeler 092 112 2334/ });
    expect(call.getAttribute("href")).toBe("tel:0921122334");
    expect(within(panel).getByText("Darb Assabil")).toBeTruthy();
  });

  it("recording an action: outcomes follow the action type, save waits for an outcome, the reminder rides along", () => {
    const props = mount();
    fireEvent.click(within(rowOf("Amina El Fitouri")).getAllByRole("button", { name: "Appeler le 2ᵉ numéro" })[0]);
    const sheet = screen.getByRole("dialog", { name: "Enregistrer une action" });
    const save = within(sheet).getByRole("button", { name: "Enregistrer l'action" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(within(sheet).getByRole("button", { name: "Livreur" }));
    expect(within(sheet).getByRole("button", { name: "Colis localisé" })).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Ne répond pas" })).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "Client" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Ne répond pas" }));
    expect(within(sheet).getByRole("button", { name: /Dans 2 h/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(within(sheet).getByRole("textbox"), { target: { value: " rappel ce soir " } });
    fireEvent.click(save);

    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "o1" }),
      { action_type: "call_customer", outcome: "no_answer", note: "rappel ce soir", next_action_at: new Date(NOW + 2 * 3600e3).toISOString(), template_key: null },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the panel records a call outcome in one tap, with the reminder that outcome implies", () => {
    const props = mount();
    fireEvent.click(within(rowOf("Amina El Fitouri")).getByText("Amina El Fitouri"));
    const panel = screen.getByRole("region", { name: "Détail du colis" });
    const outcomes = within(panel).getByRole("group", { name: "Résultat de l'appel" });
    expect(within(outcomes).getAllByRole("button").map((b) => b.textContent)).toEqual(["A répondu", "Pas de réponse", "Promet de recevoir", "Refuse le colis"]);
    fireEvent.click(within(outcomes).getByRole("button", { name: "Pas de réponse" }));
    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "o1" }),
      { action_type: "call_customer", outcome: "no_answer", note: null, next_action_at: new Date(NOW + 2 * 3600e3).toISOString(), template_key: null },
    );
  });

  it("WhatsApp opens in the market's language, links the E.164 number and logs the send with its template", () => {
    const props = mount();
    fireEvent.click(within(rowOf("Amina El Fitouri")).getByText("Amina El Fitouri"));
    fireEvent.click(within(screen.getByRole("region", { name: "Détail du colis" })).getByRole("button", { name: "WhatsApp" }));
    const sheet = screen.getByRole("dialog", { name: "Envoyer sur WhatsApp" });
    expect(within(sheet).getByRole("button", { name: "العربية" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(sheet).getByRole("button", { name: "Livreur n'a pas pu joindre" }).getAttribute("aria-pressed")).toBe("true");
    const open = within(sheet).getByRole("link", { name: "Ouvrir WhatsApp" });
    expect(open.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/218914456677\?text=/);
    fireEvent.click(open);
    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "o1" }),
      { action_type: "whatsapp_customer", outcome: "sent", note: null, next_action_at: null, template_key: "courier_no_answer" },
    );
  });

  it("while an action waits to be written, the toast offers undo", () => {
    const props = mount({
      pending: { orderId: "o1", before: AMINA, body: { action_type: "call_customer", outcome: "no_answer", note: null, next_action_at: null } },
    });
    const toast = screen.getByRole("status");
    expect(within(toast).getByText("Action enregistrée")).toBeTruthy();
    fireEvent.click(within(toast).getByRole("button", { name: "Annuler" }));
    expect(props.onUndo).toHaveBeenCalled();
  });

  it("managers see which agent owns each parcel, and no personal scorecard", () => {
    mount({ role: "market_manager", scorecard: null });
    expect(within(rowOf("Amina El Fitouri")).getByText("Hend")).toBeTruthy();
    expect(screen.queryByTestId("delivery-stat")).toBeNull();
  });

  it("parcels the carrier abandoned months ago collapse behind one line, and open on demand", () => {
    const dead = (id: string, days: number) =>
      row({
        order_id: id, external_id: id, customer_name: `Colis ${id}`, bucket: "act_now",
        reason_codes: [`stalled:${days}`], remark_class: null, latest_remark: null, hours_on_status: days * 24,
        // Whatever the courier last said, they said it months ago too.
        latest_remark_at: new Date(NOW - days * 86400e3).toISOString(),
        latest_event_at: new Date(NOW - days * 86400e3).toISOString(),
      });
    mount({ rows: [AMINA, dead("d1", 85), dead("d2", 90)] });

    // The one parcel worth a call is visible; the two dead ones are not.
    expect(within(list()).getByText("Amina El Fitouri")).toBeTruthy();
    expect(within(list()).queryByText("Colis d1")).toBeNull();

    const toggle = screen.getByRole("button", { name: /2 colis sans mouvement/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(list()).getByText("Colis d1")).toBeTruthy();
    expect(within(list()).getByText("Colis d2")).toBeTruthy();
  });

  it("the agent sees the customer's numbers on each row, not their own name", () => {
    mount();
    const amina = rowOf("Amina El Fitouri");
    expect(within(amina).getByText(/091 445 6677 · 092 112 2334/)).toBeTruthy();
    expect(within(amina).queryByText("Hend")).toBeNull();
  });

  it("loading and error states", () => {
    mount({ rows: null });
    expect(list().getAttribute("aria-busy")).toBe("true");
  });

  it("an error offers a retry", () => {
    const props = mount({ rows: null, error: true });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
