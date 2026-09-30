import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProspectRow } from "@/lib/prospects/types";

let thread: Record<string, unknown> | null = null;
vi.mock("@/hooks/useWhatsAppThread", () => ({
  useWhatsAppThread: () => ({ thread, unread: 0, isLoading: false, error: null, mutate: vi.fn(), markRead: vi.fn(), retry: vi.fn() }),
}));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({
  useWhatsAppTemplates: () => ({
    templates: [
      { id: "camp", market_id: "m", name: "ordra_camp_serum_260925", language: "ar", category: "MARKETING", status: "APPROVED", rejected_reason: null, components: [], body_text: "مرحباً {{1}}", header_format: null, footer_text: "أرسل توقف لإيقاف الرسائل", variables: ["name"], event_key: null, catalogue_key: null, source: "campaign", campaign_id: "c1", synced_at: null },
      { id: "fu", market_id: "m", name: "ordra_prospect_follow_up_v1", language: "ar", category: "MARKETING", status: "APPROVED", rejected_reason: null, components: [], body_text: "مرحباً {{1}}، سألتنا عن {{2}}", header_format: null, footer_text: null, variables: ["name", "product"], event_key: null, catalogue_key: "prospect_follow_up", source: "catalogue", campaign_id: null, synced_at: null },
    ],
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

import { ProspectWhatsAppSheet } from "../ProspectWhatsAppSheet";

const ROW = {
  id: "l2", market_id: "m", customer_name: "هدى المصراتي", customer_phone: "0921187740", customer_city: "مصراتة", product_name: "سيروم فيتامين C",
  campaign_id: "c1", campaign_name: "Sérum · clients 60–120 j", campaign_offer: "خصم 15%", assigned_name: "Tasnim",
} as unknown as ProspectRow;

const base = { conversation: null, messages: [], phone_e164: "218921187740", customer_language: null, window_open: false, window_closes_at: null, config_active: true, config_status: "active" };

const mount = () =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <ProspectWhatsAppSheet row={ROW} market="ly" marketId="m" onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );

/** Prototype whatsapp-agent-v1.html, screen `prospects`, row 2 (« a répondu »). */
describe("ProspectWhatsAppSheet", () => {
  it("quotes the prospect's reply at the top, names the campaign chip, and uses the sheet layout", () => {
    thread = {
      ...base,
      window_open: true,
      window_closes_at: "2026-09-26T08:19:00Z",
      messages: [
        { id: "o", direction: "out", kind: "template", body: "مرحباً هدى", status: "read", created_at: "2026-09-24T08:00:00Z" },
        { id: "i", direction: "in", kind: "text", body: "نعم، ما زلت أريده. كم سعر التوصيل؟", status: "received", created_at: "2026-09-25T08:19:00Z" },
      ],
    };
    mount();
    expect(screen.getByTestId("prospect-reply")).toHaveTextContent("نعم، ما زلت أريده. كم سعر التوصيل؟");
    expect(screen.getByRole("tab", { name: "Sérum · clients 60–120 j" })).toBeInTheDocument();
    expect(screen.getByText("Choisir le modèle")).toBeInTheDocument();
  });

  it("not connected: the banner and today's wa.me link to the prospect", () => {
    thread = { ...base, config_active: false, config_status: null };
    mount();
    expect(screen.getByText("WhatsApp n'est pas connecté pour ce marché")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ouvrir WhatsApp/ })).toHaveAttribute("href", "https://wa.me/218921187740");
  });
});
