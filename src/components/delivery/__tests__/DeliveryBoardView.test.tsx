import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { DeliveryBoardAgent, WorklistRow } from "@/lib/delivery/types";

vi.mock("@/hooks/useDeliveryTimeline", () => ({
  useDeliveryTimeline: () => ({ timeline: [], isLoading: false, error: null }),
}));

import { DeliveryBoardView, type DeliveryBoardViewProps } from "../DeliveryBoardView";

const NOW = Date.parse("2026-09-13T10:30:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function row(over: Partial<WorklistRow>): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "out_for_delivery", bucket: "act_now",
    reason_codes: ["remark:no_answer"], hours_on_status: 9, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 185, customer_name: "Amina El Fitouri", customer_phone: "0914456677", customer_phone_2: null,
    customer_city: "Tripoli", customer_address: "Aïn Zara", assigned_to: "agent-1", agent_name: "Hend",
    tracking_number: "5501", carrier_id: "c1", carrier_status_slug: "out_for_delivery", latest_remark: null,
    latest_remark_at: null, remark_class: "no_answer", delayed_until: null, resend_count: 0,
    handler_name: "Ali Ben Omar", handler_phone: "0912345678", handler_account_name: null, handler_account_phone: null,
    to_branch_group: null, latest_event_at: ago(9), customer_orders_count: 1, customer_delivered_count: 0,
    customer_returned_count: 0, customer_rejected_count: 0, customer_risk_class: "none",
    last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
    has_open_task: false, terminal_at: null, created_at: ago(40), carrier_name: "Darb Assabil",
    items: [], ...over,
  };
}

/** Hend is late (a 9 h parcel, never acted on); Salima holds only a quiet one. */
const HEND_LATE = row({ order_id: "o1", assigned_to: "agent-1", agent_name: "Hend" });
const SALIMA_QUIET = row({
  order_id: "o2", assigned_to: "agent-2", agent_name: "Salima", customer_name: "Huda Al-Mabrouk",
  bucket: "waiting_carrier", reason_codes: [], remark_class: null, hours_on_status: 3, total_price: 95,
});

const ACTIVITY: DeliveryBoardAgent[] = [
  { agent_id: "agent-1", name: "Hend", actions_today: 2, reached_today: 1, whatsapp_today: 1, saved_week: 1, lost_week: 0, week: [1, 0, 2, 3, 0, 1, 2] },
  { agent_id: "agent-2", name: "Salima", actions_today: 4, reached_today: 3, whatsapp_today: 0, saved_week: 0, lost_week: 0, week: [0, 1, 1, 0, 2, 0, 4] },
];

/**
 * The agent's name appears twice on purpose — the strip pill and the summary
 * card are both ways in. The card is the one carrying the verdict sentence.
 */
function openAgentCard(name: string) {
  const card = screen.getAllByRole("button", { name: new RegExp(name) })
    .find((el) => el.className.includes("grid-cols-[34px"));
  if (!card) throw new Error(`no summary card for ${name}`);
  return card;
}

function mount(over: Partial<DeliveryBoardViewProps> = {}) {
  const props: DeliveryBoardViewProps = {
    rows: [HEND_LATE, SALIMA_QUIET],
    error: false,
    onRetry: vi.fn(),
    activity: ACTIVITY,
    targetHours: 4,
    role: "market_manager",
    marketCode: "ly",
    marketLabel: "Libye",
    tz: "Africa/Tripoli",
    locale: "fr",
    now: NOW,
    pending: null,
    notice: null,
    onQueue: vi.fn(),
    onUndo: vi.fn(),
    onDismissNotice: vi.fn(),
    onReassign: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli" now={new Date(NOW)}>
      <DeliveryBoardView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("the manager board opens on the team, not on a parcel", () => {
  it("shows the market summary before anything is selected", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Vue d'ensemble" })).toBeInTheDocument();
    expect(screen.getByText("1 en retard")).toBeInTheDocument();
    expect(screen.getByText("1 à jour")).toBeInTheDocument();
  });

  it("groups agents by verdict and says why, in words", () => {
    mount();
    expect(screen.getByText("Besoin d'aide")).toBeInTheDocument();
    // The sentence is split across a <b>, so it is read off the card.
    expect(openAgentCard("Hend").textContent).toContain("1 colis attend au-delà de la cible sans action");
  });

  it("names every agent of the market, including one holding nothing", () => {
    mount({ activity: [...ACTIVITY, { agent_id: "agent-3", name: "Mouna", actions_today: 0, reached_today: 0, whatsapp_today: 0, saved_week: 0, lost_week: 0, week: [0, 0, 0, 0, 0, 0, 0] }] });
    expect(screen.getAllByText("Mouna").length).toBeGreaterThan(0);
  });
});

describe("clicking an agent opens their page", () => {
  it("replaces the summary with the agent's three frames", () => {
    mount();
    fireEvent.click(openAgentCard("Hend"));
    expect(screen.getByRole("heading", { name: "Hend" })).toBeInTheDocument();
    expect(screen.getByText("À faire")).toBeInTheDocument();
    expect(screen.getByText("Aujourd'hui")).toBeInTheDocument();
    expect(screen.getByText("Cette semaine")).toBeInTheDocument();
  });

  it("states the verdict and the parcel that blocks", () => {
    mount();
    fireEvent.click(openAgentCard("Hend"));
    expect(screen.getByText("En retard")).toBeInTheDocument();
    expect(screen.getByText("Ce qui bloque")).toBeInTheDocument();
    expect(screen.getByText(/attend 9 h/)).toBeInTheDocument();
  });

  it("narrows the list to that agent's parcels", () => {
    mount();
    fireEvent.click(openAgentCard("Hend"));
    const list = screen.getByRole("list", { name: "Suivi livraison" });
    expect(within(list).getByText("Amina El Fitouri")).toBeInTheDocument();
    expect(within(list).queryByText("Huda Al-Mabrouk")).not.toBeInTheDocument();
  });

  it("goes back to the whole market", () => {
    mount();
    fireEvent.click(openAgentCard("Hend"));
    fireEvent.click(screen.getByRole("button", { name: "Tous les agents" }));
    expect(screen.getByText("Besoin d'aide")).toBeInTheDocument();
  });
});

describe("reassignment", () => {
  it("offers to move the selected parcels, and says the commission follows", async () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Amina El Fitouri/ }));
    expect(screen.getByText("1 colis sélectionné")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réassigner" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/La commission de livraison suit le nouveau responsable/)).toBeInTheDocument();
  });

  it("does not offer the parcel's current owner as a target", () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Amina El Fitouri/ }));
    fireEvent.click(screen.getByRole("button", { name: "Réassigner" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /Salima/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("radio", { name: /Hend/ })).not.toBeInTheDocument();
  });

  it("sends the move only once an agent is picked", async () => {
    const props = mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Amina El Fitouri/ }));
    fireEvent.click(screen.getByRole("button", { name: "Réassigner" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /^Réassigner$/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Salima/ }));
    fireEvent.click(confirm);
    expect(props.onReassign).toHaveBeenCalledWith(["o1"], "agent-2");
  });

  it("moves an absent agent's whole live list from their page", () => {
    mount();
    fireEvent.click(openAgentCard("Hend"));
    fireEvent.click(screen.getByRole("button", { name: /Hend absent.*déplacer/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("the couriers tab", () => {
  it("lists who is holding the market's parcels", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Livreurs" }));
    expect(screen.getByText("Ali Ben Omar")).toBeInTheDocument();
  });
});

describe("what the agent's screen already decided still holds", () => {
  it("keeps the agent's buckets, counts and rows", () => {
    mount();
    expect(screen.getByRole("button", { name: /À traiter maintenant/ })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Suivi livraison" });
    expect(within(list).getByText("Amina El Fitouri")).toBeInTheDocument();
  });

  it("opens the parcel detail when a row is clicked, replacing the cockpit", () => {
    mount();
    fireEvent.click(screen.getByText("Amina El Fitouri"));
    expect(screen.queryByRole("heading", { name: "Vue d'ensemble" })).not.toBeInTheDocument();
    expect(screen.getByText("Prochaine action")).toBeInTheDocument();
  });
});
