import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorklistRow } from "@/lib/delivery/types";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});
const mutate = vi.fn();
vi.mock("@/hooks/useWhatsAppThread", () => ({
  useWhatsAppThread: () => ({
    thread: {
      conversation: { id: "conv-1", phone_e164: "218914456677", customer_id: "c", current_order_id: "o1", current_lead_id: null, profile_name: null, last_inbound_at: null, last_outbound_at: null, unread_count: 0, opted_out_at: null, opt_out_text: null, undeliverable_at: null },
      messages: [],
      phone_e164: "218914456677",
      customer_language: null,
      window_open: false,
      window_closes_at: null,
      config_active: true,
      config_status: "active",
    },
    unread: 0,
    isLoading: false,
    error: null,
    mutate,
    markRead: vi.fn(),
  }),
}));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({
  useWhatsAppTemplates: () => ({
    templates: [
      { id: "cn-ar", market_id: "ly", name: "ordra_courier_no_answer_v1", language: "ar", category: "UTILITY", status: "APPROVED", rejected_reason: null, components: [], body_text: "مرحباً {{1}}، حاول المندوب {{2}} الاتصال بك دون رد.", header_format: null, footer_text: null, variables: ["name", "courier"], event_key: null, catalogue_key: "courier_no_answer", source: "catalogue", campaign_id: null, synced_at: null },
      { id: "bd-ar", market_id: "ly", name: "ordra_before_delivery_v1", language: "ar", category: "UTILITY", status: "APPROVED", rejected_reason: null, components: [], body_text: "مرحباً {{1}}", header_format: null, footer_text: null, variables: ["name"], event_key: null, catalogue_key: "before_delivery", source: "catalogue", campaign_id: null, synced_at: null },
    ],
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

import { WhatsAppLiveSheet } from "../WhatsAppLiveSheet";

const LY = "00000000-0000-0000-0000-000000000002";
const ROW = {
  order_id: "o1", external_id: "LY-2081", status: "out_for_delivery", bucket: "act_now", reason_codes: ["remark:no_answer"], hours_on_status: 3, next_action_at: null, is_risky: false, risk_reasons: [],
  total_price: 150, customer_name: "Amina El Fitouri", customer_phone: "0914456677", customer_phone_2: null, customer_city: "Tripoli", customer_address: "Hay Andalus", assigned_to: "ag-1", agent_name: "Tasnim",
  tracking_number: "DA91203", carrier_id: "car", carrier_status_slug: null, latest_remark: null, latest_remark_at: null, remark_class: "no_answer", delayed_until: null, resend_count: 0, handler_name: "Ali", handler_phone: null,
  handler_account_name: null, handler_account_phone: null, to_branch_group: null, latest_event_at: null, customer_orders_count: 1, customer_delivered_count: 0, customer_returned_count: 0, customer_rejected_count: 0,
  customer_risk_class: null, last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null, has_open_task: false, terminal_at: null, created_at: null, carrier_name: "Darb Assabil", items: [],
} as unknown as WorklistRow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "m-1", status: "sent", template_id: "cn-ar" } }), { status: 201 }));
});

describe("WhatsAppLiveSheet", () => {
  it("preselects the parcel's situation, fills the variables from the row, sends for real and hands back an already-recorded action", async () => {
    const onSent = vi.fn();
    render(<WhatsAppLiveSheet row={ROW} market="ly" marketId={LY} onClose={vi.fn()} onSent={onSent} />);
    expect(screen.getByRole("dialog", { name: "Envoyer sur WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: "Livreur n'a pas pu joindre" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("whatsapp-preview")).toHaveTextContent("مرحباً Amina، حاول المندوب Ali الاتصال بك دون رد.");
    // No wa.me link on the live sheet.
    expect(screen.queryByRole("link", { name: "Ouvrir WhatsApp" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/whatsapp/send");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ target: { order_id: "o1" }, language: "ar", mode: "template", template_id: "cn-ar", log_delivery_action: true });
    await waitFor(() =>
      expect(onSent).toHaveBeenCalledWith({ action_type: "whatsapp_customer", outcome: "sent", note: null, next_action_at: null, template_key: "courier_no_answer", alreadyRecorded: true }),
    );
    expect(mutate).toHaveBeenCalled();
  });

  it("is the prototype's sheet: the customer card, the two labelled blocks, then « Envoyé » with the recorded line and « Fermer »", async () => {
    const onClose = vi.fn();
    render(<WhatsAppLiveSheet row={ROW} market="ly" marketId={LY} onClose={onClose} onSent={vi.fn()} />);
    const who = screen.getByTestId("wa-sheet-who");
    expect(who).toHaveTextContent("Amina El Fitouri");
    expect(who).toHaveTextContent("0914456677");
    expect(screen.getByText("Choisir le modèle")).toBeInTheDocument();
    expect(screen.getByText("Texte du message")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const after = (await screen.findByText("Consigné dans la fiche · statut mis à jour en direct")).closest("[role='status']") as HTMLElement;
    await userEvent.click(within(after).getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalled();
  });
});
