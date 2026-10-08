import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import type { DeliveryBoardAgent, WorklistRow } from "@/lib/delivery/types";

vi.mock("@/hooks/useDeliveryTimeline", () => ({
  useDeliveryTimeline: () => ({
    timeline: [
      { id: "e1", source: "remark", at: "2026-09-13T08:00:00Z", kind: "remark", text: "الزبون لا يرد", outcome: null, actor: "Adel", mine: false },
      { id: "e2", source: "order", at: "2026-09-12T08:00:00Z", kind: "uploaded", text: null, outcome: null, actor: null, mine: false },
      { id: "e3", source: "order", at: "2026-09-11T08:00:00Z", kind: "confirmed", text: null, outcome: null, actor: null, mine: false },
      { id: "e4", source: "order", at: "2026-09-10T08:00:00Z", kind: "pending", text: null, outcome: null, actor: null, mine: false },
    ],
    isLoading: false, error: null,
  }),
}));

import { DeliveryBoardView, type DeliveryBoardViewProps } from "../BoardView";

const NOW = Date.parse("2026-09-13T10:30:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function row(over: Partial<WorklistRow>): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "out_for_delivery", bucket: "act_now",
    reason_codes: ["remark:no_answer"], hours_on_status: 9, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 185, customer_name: "Amina El Fitouri", customer_phone: "0914456677", customer_phone_2: null,
    customer_city: "Tripoli", customer_address: "Aïn Zara", assigned_to: "agent-1", agent_name: "Hend",
    tracking_number: "5501", carrier_id: "c1", carrier_status_slug: "out_for_delivery", latest_remark: "الزبون لا يرد",
    latest_remark_at: ago(2), remark_class: "no_answer", delayed_until: null, resend_count: 0,
    handler_name: "Adel", handler_phone: "0912345678", handler_account_name: null, handler_account_phone: null,
    to_branch_group: null, latest_event_at: ago(9), customer_orders_count: 3, customer_delivered_count: 2,
    customer_returned_count: 1, customer_rejected_count: 0, customer_risk_class: "none",
    last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
    has_open_task: false, terminal_at: null, created_at: ago(40), carrier_name: "Darb Assabil",
    items: [{ product_name: "Sérum Éclat", variant_label: null, quantity: 1, image_url: null }], ...over,
  };
}

/** Hend is late (a 9 h parcel, never acted on); Salima holds a quiet one; one parcel has no agent; one stall. */
const HEND_LATE = row({ order_id: "o1", reason_codes: ["remark:wrong_address"], remark_class: "wrong_address" });
const SALIMA_QUIET = row({
  order_id: "o2", assigned_to: "agent-2", agent_name: "Salima", customer_name: "Huda Al-Mabrouk",
  bucket: "waiting_carrier", reason_codes: [], remark_class: null, latest_remark: null, latest_remark_at: null, hours_on_status: 3, total_price: 95,
});
const NO_AGENT = row({
  order_id: "o3", assigned_to: null, agent_name: null, customer_name: "Omar Zayani", bucket: "returning", status: "returning",
  reason_codes: [], remark_class: null, latest_remark: null, latest_remark_at: null, hours_on_status: 20, total_price: 220,
});
const STALL = row({
  order_id: "o4", customer_name: "Rami Stalled", reason_codes: ["stalled:5"], remark_class: null, latest_remark: null,
  latest_remark_at: null, hours_on_status: 30 * 24, latest_event_at: ago(30 * 24),
});
const DONE = row({ order_id: "o5", bucket: "done", status: "delivered", customer_name: "Lina Done", reason_codes: [] });

const ACTIVITY: DeliveryBoardAgent[] = [
  { agent_id: "agent-1", name: "Hend", actions_today: 2, reached_today: 1, whatsapp_today: 1, saved_week: 3, lost_week: 1, week: [0, 0, 0, 0, 0, 0, 2], color: "pink" },
  { agent_id: "agent-2", name: "Salima", actions_today: 4, reached_today: 3, whatsapp_today: 0, saved_week: 2, lost_week: 0, week: [0, 0, 0, 0, 0, 0, 4], color: null },
];

function mount(over: Partial<DeliveryBoardViewProps> = {}, messages: AbstractIntlMessages = fr, locale = "fr") {
  const props: DeliveryBoardViewProps = {
    rows: [HEND_LATE, SALIMA_QUIET, NO_AGENT, STALL, DONE],
    error: false, onRetry: vi.fn(), activity: ACTIVITY, targetHours: 4, role: "market_manager",
    marketCode: "ly", marketLabel: "Libye", tz: "Africa/Tripoli", locale, now: NOW,
    pending: null, notice: null, onQueue: vi.fn(), onUndo: vi.fn(), onDismissNotice: vi.fn(),
    onReassign: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Tripoli" now={new Date(NOW)}
      onError={(e) => { throw e; }}>
      <DeliveryBoardView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const rowOf = (name: string) => screen.getByText(name).closest(".row") as HTMLElement;
const listNames = () => Array.from(document.querySelectorAll(".row bdi.cname")).map((el) => el.textContent);

describe("header", () => {
  it("says the market, what is in flight, the week and the target", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Suivi livraison" })).toBeInTheDocument();
    expect(screen.getByText("Libye · 3 colis en route · 2 agents")).toBeInTheDocument();
    expect(screen.getByText("Cette semaine · 5 sauvés · 1 perdus")).toBeInTheDocument();
    expect(screen.getByText(/Cible/).textContent).toContain("4 h");
  });
});

describe("« À faire »", () => {
  it("counts the problems and lists them on demand, each with its button", () => {
    mount();
    const btn = screen.getByRole("button", { name: /À faire/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    const panel = screen.getByRole("region", { name: "À faire" });
    expect(within(panel).getByText(/attendent au-delà de la cible/)).toBeInTheDocument();
    expect(within(panel).getByText(/n’ont pas d’agent/)).toBeInTheDocument();
    expect(within(panel).getByText(/sans mouvement depuis plus de 21 jours/)).toBeInTheDocument();
  });

  it("« Voir » on the late line shows the late parcels", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /À faire/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "À faire" })).getAllByRole("button", { name: "Voir" })[0]);
    expect(screen.getByRole("tab", { name: /En retard/ })).toHaveAttribute("aria-selected", "true");
    expect(listNames()).toEqual(["Amina El Fitouri"]);
  });

  it("« Attribuer » opens the reassign dialog on the parcels nobody follows", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /À faire/ }));
    fireEvent.click(screen.getByRole("button", { name: "Attribuer" }));
    expect(screen.getByRole("dialog", { name: /Réattribuer 1 colis/ })).toBeInTheDocument();
  });

  it("a calm market says so instead of a count", () => {
    mount({ rows: [SALIMA_QUIET] });
    expect(screen.queryByRole("button", { name: /À faire/ })).toBeNull();
    expect(screen.getByText("Tout est à jour")).toBeInTheDocument();
  });
});

describe("bucket tiles and agent cards filter the list", () => {
  it("one tile per live bucket, with its count; a click narrows the list", () => {
    mount();
    const tile = screen.getByRole("button", { name: /Retours à sauver/ });
    expect(within(tile).getByText("1")).toBeInTheDocument();
    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(listNames()).toEqual(["Omar Zayani"]);
  });

  it("the act-now tile flags its late parcels", () => {
    mount();
    expect(within(screen.getByRole("button", { name: /À traiter maintenant/ })).getByText("1 en retard")).toBeInTheDocument();
  });

  it("an agent card shows her verdict and week; a click shows only her parcels and offers to move all she holds (the stall too)", () => {
    mount();
    const card = screen.getByRole("button", { name: /^Hend/ });
    expect(within(card).getByText("1 en retard")).toBeInTheDocument();
    expect(card.textContent).toContain("3 sauvés");
    fireEvent.click(card);
    expect(listNames()).toEqual(["Amina El Fitouri"]);
    expect(screen.getByRole("button", { name: /Réattribuer ses 2/ })).toBeInTheDocument();
  });
});

describe("the team strip stays one row", () => {
  const idle = (i: number): DeliveryBoardAgent => ({ agent_id: `x${i}`, name: `Zed ${i}`, actions_today: 0, reached_today: 0, whatsapp_today: 0, saved_week: 0, lost_week: 0, week: [0, 0, 0, 0, 0, 0, 0] });
  const busy = (i: number): DeliveryBoardAgent => ({ ...idle(i), agent_id: `b${i}`, name: `Busy ${i}`, actions_today: 1 });

  it("an agent with nothing in flight and nothing done today gets no card", () => {
    mount({ activity: [...ACTIVITY, idle(1)] });
    expect(screen.queryByRole("button", { name: /^Zed 1/ })).toBeNull();
  });

  it("past six cards, the rest wait behind « +N »", () => {
    mount({ activity: [...ACTIVITY, ...[1, 2, 3, 4, 5, 6].map(busy)] });
    expect(screen.getAllByRole("button", { pressed: false }).filter((b) => b.className.includes("ag2"))).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "+2" }));
    expect(screen.getAllByRole("button").filter((b) => b.className.includes("ag2"))).toHaveLength(8);
  });
});

describe("the list", () => {
  it("states: in flight, late, stalled, done — each with its count", () => {
    mount();
    expect(screen.getByRole("tab", { name: "En cours 3" })).toHaveAttribute("aria-selected", "true");
    expect(listNames()).toEqual(["Amina El Fitouri", "Omar Zayani", "Huda Al-Mabrouk"]);
    fireEvent.click(screen.getByRole("tab", { name: /Sans mouvement/ }));
    expect(listNames()).toEqual(["Rami Stalled"]);
    fireEvent.click(screen.getByRole("tab", { name: /Terminées/ }));
    expect(listNames()).toEqual(["Lina Done"]);
  });

  it("a row reads situation, client, product, agent, last trace, wait and amount", () => {
    mount();
    const r = rowOf("Amina El Fitouri");
    expect(within(r).getByText(/Adresse/)).toBeInTheDocument();
    expect(within(r).getByText("Sérum Éclat")).toBeInTheDocument();
    expect(within(r).getByText("Hend")).toBeInTheDocument();
    expect(r.textContent).toContain("الزبون لا يرد");
    expect(within(r).getByText("en retard")).toBeInTheDocument();
    expect(r.textContent).toContain("185");
  });

  it("the parcel with no agent says so in the agent column", () => {
    mount();
    expect(within(rowOf("Omar Zayani")).getByText("Sans agent")).toBeInTheDocument();
  });

  it("search narrows by name, city or number", () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText("Nom, numéro, ville, suivi…"), { target: { value: "huda" } });
    expect(listNames()).toEqual(["Huda Al-Mabrouk"]);
  });

  it("a filter button says its value and can be cleared", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Agent : Tous/ }));
    fireEvent.click(screen.getByRole("option", { name: /Salima/ }));
    expect(screen.getByRole("button", { name: /Agent : Salima/ })).toBeInTheDocument();
    expect(listNames()).toEqual(["Huda Al-Mabrouk"]);
    fireEvent.click(screen.getByRole("button", { name: "Retirer ce filtre" }));
    expect(listNames()).toHaveLength(3);
  });

  it("selecting rows brings the bulk bar; reassigning sends the ids and the agent", async () => {
    const p = mount();
    fireEvent.click(within(rowOf("Amina El Fitouri")).getByRole("checkbox"));
    fireEvent.click(within(rowOf("Omar Zayani")).getByRole("checkbox"));
    expect(screen.getByText("2 colis sélectionnés")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Réattribuer$/ }));
    const dlg = screen.getByRole("dialog", { name: /Réattribuer 2 colis/ });
    fireEvent.click(within(dlg).getByRole("button", { name: /Salima/ }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Déplacer vers Salima" }));
    await waitFor(() => expect(p.onReassign).toHaveBeenCalledWith(["o1", "o3"], "agent-2"));
  });

  it("no parcel at all is an empty state, not an empty table", () => {
    mount({ rows: [] });
    expect(screen.getByText("Aucun colis en route")).toBeInTheDocument();
  });
});

describe("the parcel panel reads top-down", () => {
  it("who and how long, the courier's words, what to do, details, history", () => {
    mount();
    fireEvent.click(rowOf("Amina El Fitouri"));
    const panel = screen.getByRole("dialog", { name: "Amina El Fitouri" });
    expect(within(panel).getByText(/depuis 9 h/)).toBeInTheDocument();
    expect(within(panel).getByText("Ce que dit le livreur")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Appeler 091 445 6677" })).toHaveAttribute("href", "tel:0914456677");
    expect(within(panel).getByText("Résultat de l’appel")).toBeInTheDocument();
    expect(within(panel).getByText("3 commandes")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Tout l’historique (4)" })).toBeInTheDocument();
  });

  it("an outcome tile records the call without a sheet", () => {
    const p = mount();
    fireEvent.click(rowOf("Amina El Fitouri"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Amina El Fitouri" })).getByRole("button", { name: /Pas de réponse/ }));
    expect(p.onQueue).toHaveBeenCalledWith(expect.objectContaining({ order_id: "o1" }), expect.objectContaining({ outcome: "no_answer", action_type: "call_customer" }));
  });

  it("closes on its button", () => {
    mount();
    fireEvent.click(rowOf("Amina El Fitouri"));
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog", { name: "Amina El Fitouri" })).toBeNull();
  });
});

describe("the couriers view", () => {
  it("shows each carrier account's load and who holds the parcels", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Livreurs/ }));
    expect(screen.getAllByText("Darb Assabil").length).toBeGreaterThan(0);
    expect(screen.getByText("Adel")).toBeInTheDocument();
  });
});

describe("Arabic", () => {
  it("renders every string without a missing key", () => {
    mount({}, ar, "ar");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    fireEvent.click(rowOf("Amina El Fitouri"));
    expect(screen.getByText("آخر كلمة من المندوب")).toBeInTheDocument();
  });
});
