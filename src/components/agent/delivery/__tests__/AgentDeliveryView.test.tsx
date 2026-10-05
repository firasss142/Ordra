import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { TimelineEntry, WorklistRow } from "@/lib/delivery/types";
import { AgentToastProvider } from "@/components/agent/shared";

const TIMELINE: TimelineEntry[] = [
  { id: "a1", source: "action", at: "2026-09-13T09:00:00Z", kind: "call_customer", text: null, outcome: "no_answer", actor: "Hend", mine: true },
  { id: "r1", source: "remark", at: "2026-09-13T07:12:00Z", kind: "remark", text: "الزبون لم يرد", outcome: null, actor: "Ali", mine: false },
  { id: "s1", source: "order", at: "2026-09-12T09:00:00Z", kind: "uploaded", text: null, outcome: null, actor: null, mine: false },
];
vi.mock("@/hooks/useDeliveryTimeline", () => ({
  useDeliveryTimeline: () => ({ timeline: TIMELINE, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useWhatsAppThread", () => ({
  useWhatsAppThread: () => ({ thread: { messages: [], conversation: null, config_active: true } }),
}));
vi.mock("@/components/delivery/WhatsAppLiveSheet", () => ({
  WhatsAppLiveSheet: ({ onSent }: { onSent: (b: Record<string, unknown>) => void }) => (
    <div role="dialog" aria-label="live-sheet">
      <button onClick={() => onSent({ action_type: "whatsapp_customer", outcome: "sent", note: null, next_action_at: null, template_key: "before_delivery", alreadyRecorded: true })}>live-send</button>
    </div>
  ),
}));

import { AgentDeliveryView, type AgentDeliveryViewProps } from "../AgentDeliveryView";

// 10:30 UTC = 12:30 in Tripoli.
const NOW = Date.parse("2026-09-13T10:30:00Z");

function row(over: Partial<WorklistRow>): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "out_for_delivery", bucket: "act_now",
    reason_codes: ["remark:no_answer"], hours_on_status: 5, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 185, customer_name: "Amina El Fitouri", customer_phone: "0914456677", customer_phone_2: "0921122334",
    customer_city: "Tripoli", customer_address: "Aïn Zara", assigned_to: "agent-1", agent_name: "Hend",
    tracking_number: "DRB5501", carrier_id: "c1", carrier_status_slug: "out_for_delivery", latest_remark: "الزبون لم يرد ع التلفون",
    latest_remark_at: "2026-09-13T07:12:00Z", remark_class: "no_answer", delayed_until: null, resend_count: 0,
    handler_name: "Ali Ben Omar", handler_phone: "0912345678", handler_account_name: null, handler_account_phone: null,
    to_branch_group: null, latest_event_at: "2026-09-13T07:12:00Z", customer_orders_count: 2, customer_delivered_count: 1,
    customer_returned_count: 0, customer_rejected_count: 0, customer_risk_class: "repeat",
    last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
    has_open_task: false, terminal_at: null, created_at: "2026-09-12T08:00:00Z", carrier_name: "Darb Assabil",
    items: [{ product_name: "Sérum vitamine C", variant_label: null, quantity: 2, image_url: null }],
    ...over,
  };
}

const AMINA = row({});
const HUDA = row({
  order_id: "o2", external_id: "48172", status: "returning", bucket: "returning", reason_codes: ["returning"],
  customer_name: "Huda Al-Mabrouk", customer_phone: "0923341122", customer_phone_2: null, total_price: 95,
  remark_class: "no_answer", latest_remark: null, handler_phone: null, handler_account_phone: "0917710099", tracking_number: "DRB7001",
  is_risky: true,
});
const TAREK = row({
  order_id: "o3", external_id: "48145", status: "delivered", bucket: "done", reason_codes: [],
  customer_name: "Tarek Ben Salem", customer_phone: "0926617788", customer_phone_2: null, total_price: 90,
  remark_class: null, latest_remark: null, terminal_at: "2026-09-13T10:05:00Z",
});
const OLD = row({
  order_id: "o4", status: "in_transit", reason_codes: ["stalled:5"], remark_class: null, latest_remark: null, latest_remark_at: null,
  customer_name: "Omar Stuck", hours_on_status: 24 * 40, tracking_number: "DRB9",
});

function mount(over: Partial<AgentDeliveryViewProps> = {}) {
  const props: AgentDeliveryViewProps = {
    rows: [HUDA, AMINA, TAREK],
    error: false,
    onRetry: vi.fn(),
    scorecard: { delivered: 7, returned: 2, delivery_rate: 78, saved: 1, window_days: 30 },
    marketCode: "ly",
    marketId: "m-ly",
    whatsappActive: false,
    whatsappKnown: true,
    tz: "Africa/Tripoli",
    locale: "fr",
    now: NOW,
    doneLoaded: false,
    onNeedDone: vi.fn(),
    pending: null,
    onQueue: vi.fn(),
    onUndo: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <AgentToastProvider>
        <AgentDeliveryView {...props} />
      </AgentToastProvider>
    </NextIntlClientProvider>,
  );
  return props;
}

const list = () => screen.getByRole("list", { name: "Suivi livraison" });
const rowOf = (name: string) => within(list()).getByText(name).closest("[role='listitem']") as HTMLElement;
const detail = () => screen.getByRole("region", { name: "Détail du colis" });

function phone(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: on && q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

beforeEach(() => { vi.clearAllMocks(); phone(false); });
afterEach(() => { vi.useRealTimers(); });

describe("AgentDeliveryView — the page (prototype dlvPage)", () => {
  it("title, parcels in flight and the 30-day pill", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Suivi livraison" })).toBeInTheDocument();
    expect(screen.getByRole("banner").querySelector(".sub")?.textContent).toBe("2 en cours");
    expect(screen.getByText(/livraison 30 j/).textContent).toMatch(/78 %.*livraison 30 j.*1.*sauvées/);
  });

  it("six tiles; « Tout » leaves the finished out; « Terminées » waits to be loaded", () => {
    const props = mount();
    const tiles = screen.getByRole("region", { name: "Seaux" });
    expect(within(tiles).getAllByRole("button")).toHaveLength(6);
    expect(within(tiles).getByRole("button", { name: /^Tout/ })).toHaveTextContent(/Tout\s*2/);
    const done = within(tiles).getByRole("button", { name: /Terminées/ });
    expect(done).toHaveTextContent("24 dernières heures");
    expect(within(list()).queryByText("Tarek Ben Salem")).toBeNull();
    fireEvent.click(done);
    fireEvent.click(screen.getByRole("button", { name: "Charger les colis terminés (24 h)" }));
    expect(props.onNeedDone).toHaveBeenCalled();
  });

  it("once loaded, « Terminées » lists the finished parcels", () => {
    mount({ doneLoaded: true });
    fireEvent.click(within(screen.getByRole("region", { name: "Seaux" })).getByRole("button", { name: /Terminées/ }));
    expect(rowOf("Tarek Ben Salem")).toBeInTheDocument();
  });

  it("returns first; the number to dial sits INSIDE the action button", () => {
    mount();
    const names = within(list()).getAllByRole("listitem").map((r) => r.querySelector(".nm")?.textContent);
    expect(names).toEqual(["Huda Al-Mabrouk", "Amina El Fitouri"]);
    expect(within(rowOf("Amina El Fitouri")).getByRole("link", { name: /Appeler le 2ᵉ numéro 092 112 2334/ })).toHaveAttribute("href", "tel:0921122334");
    expect(within(rowOf("Huda Al-Mabrouk")).getByRole("link", { name: /Sauver le retour 091 771 0099/ })).toBeInTheDocument();
    // the courier's own words
    expect(within(rowOf("Amina El Fitouri")).getByText("« الزبون لم يرد ع التلفون »")).toBeInTheDocument();
  });

  it("the desktop auto-selects the first parcel", () => {
    mount();
    expect(within(detail()).getByRole("heading", { name: "Huda Al-Mabrouk" })).toBeInTheDocument();
    fireEvent.click(within(rowOf("Amina El Fitouri")).getByText("Amina El Fitouri"));
    expect(within(detail()).getByRole("heading", { name: "Amina El Fitouri" })).toBeInTheDocument();
  });

  it("« Colis à risque seulement » and the sort « Montant »", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Filtrer/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Colis à risque seulement" }));
    expect(within(list()).queryByText("Amina El Fitouri")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Filtrer/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Colis à risque seulement" }));
    fireEvent.click(screen.getByRole("button", { name: /Trier · Priorité/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Montant" }));
    const names = within(list()).getAllByRole("listitem").map((r) => r.querySelector(".nm")?.textContent);
    expect(names).toEqual(["Amina El Fitouri", "Huda Al-Mabrouk"]);
  });

  it("search narrows the list", () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText("Rechercher par nom, numéro ou ville…"), { target: { value: "huda" } });
    expect(within(list()).queryByText("Amina El Fitouri")).toBeNull();
  });

  it("long-stalled parcels fold behind « N colis sans mouvement »", () => {
    mount({ rows: [AMINA, OLD] });
    expect(within(list()).queryByText("Omar Stuck")).toBeNull();
    const fold = screen.getByRole("button", { name: /1 colis sans mouvement/ });
    expect(fold).toHaveTextContent("Chez le transporteur depuis 40 à 40 jours");
    fireEvent.click(fold);
    expect(rowOf("Omar Stuck")).toBeInTheDocument();
  });

  it("an empty bucket says so and offers every parcel", () => {
    mount({ rows: [AMINA] });
    fireEvent.click(within(screen.getByRole("region", { name: "Seaux" })).getByRole("button", { name: /Retours à sauver/ }));
    expect(screen.getByText("Rien ici")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voir tous les colis" }));
    expect(rowOf("Amina El Fitouri")).toBeInTheDocument();
  });
});

describe("AgentDeliveryView — the parcel (prototype dlvDetail)", () => {
  const openAmina = () => fireEvent.click(within(rowOf("Amina El Fitouri")).getByText("Amina El Fitouri"));

  it("next action, both rows of one-tap tiles, the client, the carrier, the parcel and the journal", () => {
    mount();
    openAmina();
    const d = detail();
    expect(within(d).getByText("Prochaine action")).toBeInTheDocument();
    expect(within(d).getByRole("link", { name: /Appeler 092 112 2334/ })).toHaveAttribute("href", "tel:0921122334");
    expect(within(d).getByRole("button", { name: "A répondu" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Colis localisé" })).toBeInTheDocument();
    expect(within(d).getByText("Recommandé")).toBeInTheDocument();
    expect(within(d).getByText("Ali Ben Omar")).toBeInTheDocument();
    expect(within(d).getByText("Fiable · 2 commandes · 1 livrées")).toBeInTheDocument();
    expect(within(d).getAllByText("DRB5501").length).toBeGreaterThan(0);
    expect(within(d).getByText(/Sérum vitamine C ×2/)).toBeInTheDocument();
    // journal + its filter — folded until asked for, like the messages
    expect(within(d).queryByText(/Ne répond pas/)).toBeNull();
    fireEvent.click(within(d).getByRole("button", { name: "Journal d'activité" }));
    fireEvent.click(within(d).getByRole("button", { name: "Messages" }));
    expect(within(d).getByText(/Ne répond pas/)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Transporteur" }));
    expect(within(d).queryByText(/Ne répond pas/)).toBeNull();
    expect(within(within(d).getByRole("list")).getByText(/الزبون لم يرد/)).toBeInTheDocument();
    expect(within(d).getByText("Aucun message avec ce client.")).toBeInTheDocument();
  });

  it("a one-tap tile records the call, moves the parcel, and offers « Annuler » for 5 s", () => {
    const props = mount();
    openAmina();
    fireEvent.click(within(detail()).getByRole("button", { name: "Pas de réponse" }));
    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "o1" }),
      expect.objectContaining({ action_type: "call_customer", outcome: "no_answer", next_action_at: new Date(NOW + 2 * 3_600_000).toISOString() }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Action enregistrée · déplacé vers « En attente client »");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Annuler" }));
    expect(props.onUndo).toHaveBeenCalled();
  });

  it("a courier tile is recorded as a call to the courier", () => {
    const props = mount();
    openAmina();
    fireEvent.click(within(detail()).getByRole("button", { name: "Colis localisé" }));
    expect(props.onQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action_type: "call_courier", outcome: "parcel_located" }));
  });

  it("« Enregistrer une action »: who, the result, why, the reminder — then saved", () => {
    const props = mount();
    openAmina();
    fireEvent.click(within(detail()).getByRole("button", { name: "Plus d'actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Enregistrer une action" }));
    const sheet = screen.getByRole("dialog", { name: "Enregistrer une action" });
    const save = within(sheet).getByRole("button", { name: "Enregistrer l'action" });
    expect(save).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Livreur" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Info transmise" }));
    fireEvent.change(within(sheet).getByPlaceholderText("Pourquoi ? Garder ce que le client a dit"), { target: { value: "il passe demain" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Demain" }));
    fireEvent.click(save);
    expect(props.onQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action_type: "call_courier", outcome: "info_passed", note: "il passe demain", next_action_at: expect.any(String),
    }));
    expect(screen.queryByRole("dialog", { name: "Enregistrer une action" })).toBeNull();
  });

  it("a note alone needs words", () => {
    const props = mount();
    openAmina();
    fireEvent.click(within(detail()).getByRole("button", { name: "Plus d'actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Enregistrer une action" }));
    const sheet = screen.getByRole("dialog", { name: "Enregistrer une action" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Note seule" }));
    const save = within(sheet).getByRole("button", { name: "Enregistrer l'action" });
    expect(save).toBeDisabled();
    fireEvent.change(within(sheet).getByPlaceholderText("Pourquoi ? Garder ce que le client a dit"), { target: { value: "client à l'étranger" } });
    fireEvent.click(save);
    expect(props.onQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action_type: "note", outcome: "none", next_action_at: null }));
  });

  it("the row's WhatsApp button opens the WhatsApp sheet and the send is recorded", () => {
    const props = mount();
    fireEvent.click(within(rowOf("Amina El Fitouri")).getByRole("button", { name: "WhatsApp" }));
    const sheet = screen.getByRole("dialog", { name: "Envoyer sur WhatsApp" });
    fireEvent.click(within(sheet).getByRole("link", { name: "Ouvrir WhatsApp" }));
    expect(props.onQueue).toHaveBeenCalledWith(expect.objectContaining({ order_id: "o1" }), expect.objectContaining({ action_type: "whatsapp_customer" }));
  });

  it("a live WhatsApp send is already recorded: no undo", () => {
    const props = mount({ whatsappActive: true });
    fireEvent.click(within(rowOf("Amina El Fitouri")).getByRole("button", { name: "WhatsApp" }));
    fireEvent.click(screen.getByText("live-send"));
    expect(props.onQueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ alreadyRecorded: true }));
    expect(within(screen.getByRole("status")).queryByRole("button", { name: "Annuler" })).toBeNull();
  });

  it("a finished parcel has no tiles and no call", () => {
    mount({ rows: [TAREK], doneLoaded: true });
    fireEvent.click(within(screen.getByRole("region", { name: "Seaux" })).getByRole("button", { name: /Terminées/ }));
    expect(within(detail()).queryByRole("button", { name: "A répondu" })).toBeNull();
  });
});

describe("AgentDeliveryView — the phone (prototype dlvPhone + dlvPhoneDetail, decision 10)", () => {
  it("cards with the move inside; a card opens the full-screen parcel with tracking, tiles and Messages", () => {
    phone(true);
    const props = mount();
    expect(screen.queryByRole("region", { name: "Détail du colis" })).toBeNull();
    const card = screen.getByText("Amina El Fitouri").closest(".pcard") as HTMLElement;
    expect(within(card).getByText("DRB5501")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Appeler le 2ᵉ numéro 092 112 2334/ })).toBeInTheDocument();
    fireEvent.click(within(card).getByText("Amina El Fitouri"));
    const panel = screen.getByRole("dialog", { name: "Détail du colis" });
    expect(within(panel).getAllByText("DRB5501").length).toBeGreaterThan(0);
    expect(within(panel).getByRole("button", { name: "A répondu" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByRole("dialog", { name: "Enregistrer une action" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Enregistrer une action" })).getByRole("button", { name: "Annuler" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Retour" }));
    expect(screen.queryByRole("dialog", { name: "Détail du colis" })).toBeNull();
    expect(props.onQueue).not.toHaveBeenCalled();
  });
});

describe("AgentDeliveryView — loading and failure", () => {
  it("a failed first load offers a retry", () => {
    const props = mount({ rows: null, error: true });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(props.onRetry).toHaveBeenCalled();
  });
  it("time passes: the toast leaves after 5 s", () => {
    vi.useFakeTimers();
    mount();
    fireEvent.click(within(detail()).getByRole("button", { name: "Pas de réponse" }));
    expect(screen.getByRole("status")).toHaveTextContent("Action enregistrée");
    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.getByRole("status")).not.toHaveTextContent("Action enregistrée");
  });
});
