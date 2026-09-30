import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProspectRow } from "@/lib/prospects/types";

// The sheet has its own suite; a stand-in shows what the view opened it with.
vi.mock("../ProspectWhatsAppSheet", () => ({
  ProspectWhatsAppSheet: ({ row }: { row: { customer_name: string } }) => <div role="dialog" aria-label="wa-sheet">{row.customer_name}</div>,
}));

import { ProspectsView, type ProspectsViewProps } from "../ProspectsView";

/** 2026-09-14 12:00 in Tripoli. */
const NOW = Date.parse("2026-09-14T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(NOW + m * 60_000).toISOString();

function row(over: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "l1", market_id: "m1", status: "assigned", source: "whatsapp", bucket: "hot",
    customer_name: "Amal Zentani", customer_phone: "0917788001",
    customer_city: "Tripoli", customer_address: null,
    product_id: null, product_name: null, product_price: null, product_image_url: null, product_note: null,
    notes: null, assigned_to: "a1", assigned_name: "Hend", callback_scheduled_at: null,
    converted_order_id: null, converted_order_ref: null,
    campaign_id: null, campaign_name: null, campaign_offer: null, campaign_script: null,
    source_order_id: null, source_order_ref: null, return_reason: null,
    repeat_kind: "none", prior_order_count: 0, prior_delivered_count: 0, prior_returned_count: 0,
    last_known_address: null,
    created_at: minutesAgo(6), updated_at: minutesAgo(6), last_touch_at: null,
    ...over,
  };
}

const HOT = row({ id: "hot", customer_name: "Amal Zentani", created_at: minutesAgo(23), product_name: "Sérum vitamine C", product_price: 110 });
const CALLBACK = row({
  id: "cb", bucket: "callback", status: "callback_scheduled", customer_name: "Houda Mabrouk",
  callback_scheduled_at: minutesAhead(95), customer_city: "Benghazi",
});
const RETRY = row({ id: "retry", bucket: "retry", status: "attempt_2", customer_name: "Fatma Arfi", customer_phone: "0919982211" });
const CAMPAIGN = row({
  id: "camp", bucket: "campaign", source: "campaign", status: "new", customer_name: "Khaled Zawi",
  campaign_id: "c1", campaign_name: "Sérum 60-120 j", campaign_offer: "−15 % sur le 50 ml",
  campaign_script: "Bonjour Khaled, ici Hend d'Ordra.",
});
const WINBACK = row({
  id: "wb", bucket: "winback", source: "winback", customer_name: "Mohamed Saleh",
  source_order_id: "o1", return_reason: "Le client n'a pas répondu au téléphone",
  prior_order_count: 1, prior_returned_count: 1,
});
const CONVERTED = row({ id: "won", bucket: "converted", status: "won", customer_name: "Samira Darsi", converted_order_id: "o9", converted_order_ref: "48219" });

function mount(over: Partial<ProspectsViewProps> = {}) {
  const props: ProspectsViewProps = {
    rows: [HOT, CALLBACK, RETRY, CAMPAIGN, WINBACK, CONVERTED],
    error: false,
    isLoading: false,
    onRetry: vi.fn(),
    role: "agent",
    marketCode: "ly",
    tz: "Africa/Tripoli",
    locale: "fr",
    now: NOW,
    hotWindowMinutes: 60,
    stats: { calls: 12, converted: 3 },
    pending: null,
    notice: null,
    onQueue: vi.fn(),
    onUndo: vi.fn(),
    onDismissNotice: vi.fn(),
    onConvert: vi.fn(),
    onNewLead: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <ProspectsView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const list = () => screen.getByRole("list", { name: "Prospects" });
const rows = () => within(list()).getAllByRole("listitem");
const rowOf = (name: string) => within(list()).getByText(name).closest("[role='listitem']") as HTMLElement;

beforeEach(() => vi.clearAllMocks());


const REPLIED = row({
  id: "rep", bucket: "campaign", source: "campaign", status: "new", customer_name: "Houda Misrati",
  campaign_id: "c1", campaign_name: "Sérum · clients 60–120 j",
  wa_sent_at: minutesAgo(26 * 60), wa_sent_status: "read", wa_replied_at: minutesAgo(12),
});
const SENT = row({
  id: "sent", bucket: "campaign", source: "campaign", status: "new", customer_name: "Souad Fitouri",
  campaign_id: "c1", campaign_name: "Sérum · clients 60–120 j",
  wa_sent_at: minutesAgo(24 * 60 + 30), wa_sent_status: "read", wa_replied_at: null,
});

describe("ProspectsView — WhatsApp (prototype whatsapp-agent-v1.html, screen `prospects`)", () => {
  test("a prospect who answered: « a répondu » chip, « a répondu il y a 12 min », and a badge on the WhatsApp square", () => {
    mount({ rows: [REPLIED, SENT], marketId: "m1", whatsappActive: true, whatsappKnown: true });
    const r = rowOf("Houda Misrati");
    expect(within(r).getAllByText("a répondu").length).toBeGreaterThan(0);
    expect(within(r).getByText("a répondu il y a 12 min")).toBeTruthy();
    const square = within(r).getByRole("button", { name: /WhatsApp/ });
    expect(square).toHaveTextContent("1");
  });

  test("a campaign message sent and not answered: « {campagne} · envoyé hier » with its live tick", () => {
    mount({ rows: [REPLIED, SENT], marketId: "m1", whatsappActive: true, whatsappKnown: true });
    const r = rowOf("Souad Fitouri");
    const line = within(r).getByTestId("prospect-wa-sent");
    expect(line).toHaveTextContent("Sérum · clients 60–120 j · envoyé hier");
    expect(within(line).getByLabelText("lu")).toBeTruthy();
  });

  test("the row's WhatsApp square opens the composer sheet for that prospect", () => {
    mount({ rows: [REPLIED, SENT], marketId: "m1", whatsappActive: true, whatsappKnown: true });
    fireEvent.click(within(rowOf("Souad Fitouri")).getByRole("button", { name: /WhatsApp/ }));
    expect(screen.getByRole("dialog", { name: "wa-sheet" })).toHaveTextContent("Souad Fitouri");
  });

  test("market not connected: the square is there but greyed, and still opens the sheet that explains why", () => {
    mount({ rows: [SENT], marketId: "m1", whatsappActive: false, whatsappKnown: true });
    const square = within(rowOf("Souad Fitouri")).getByRole("button", { name: /WhatsApp/ });
    expect(square).toHaveAttribute("data-state", "not_connected");
    fireEvent.click(square);
    expect(screen.getByRole("dialog", { name: "wa-sheet" })).toBeTruthy();
  });
});
