import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import type { AgentPanel, DayAgent, TeamDay, TeamFunnel } from "@/lib/team/room/types";

const LY = "00000000-0000-0000-0000-000000000002";
const nav = vi.hoisted(() => ({ qs: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/fr/team",
  useSearchParams: () => new URLSearchParams(nav.qs),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
const data = vi.hoisted(() => ({ day: null as unknown, funnel: null as unknown, panel: null as unknown }));
vi.mock("@/hooks/useTeamRoom", () => ({
  useTeamDay: () => ({ day: data.day, error: null, isLoading: false, mutate: vi.fn() }),
  useTeamFunnel: () => ({ funnel: data.funnel, error: null, isLoading: false }),
  useTeamAgentPanel: (_m: string, agentId: string | null) => ({ panel: agentId ? data.panel : null, error: null, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/useTeamCommissions", () => ({
  useTeamCommissions: () => ({
    commissions: {
      market_id: LY, currency: "LYD", from: "", to: "", tz: "Africa/Tripoli", market: { enabled: true, amount: 10, effective_from: "2026-09-30" },
      team: { delivered: 0, earned: 0, paid: 0, balance: 795 },
      agents: [
        { agent_id: "t", name: "tasnim", avatar_url: null, is_active: true, rate: { amount: 10, enabled: true, is_override: false, effective_from: "2026-09-30" }, delivered: 0, earned: 0, paid: 0, pending_count: 0, pending_est: 0, balance: 363, earned_total: 930, paid_total: 567, last_payout: { at: "2026-09-26T10:00:00Z", amount: 267, method: "cash" } },
        { agent_id: "s", name: "salima", avatar_url: null, is_active: true, rate: { amount: 9, enabled: true, is_override: true, effective_from: "2026-09-14" }, delivered: 0, earned: 0, paid: 0, pending_count: 0, pending_est: 0, balance: 432, earned_total: 432, paid_total: 0, last_payout: null },
      ],
    },
    mutate: vi.fn(),
  }),
}));
vi.mock("@/hooks/useRejectionReasons", () => ({
  useRejectionReasons: () => ({ rows: [{ id: "g", market_id: LY, parent_key: null, key: "commande_invalide", label_fr: "Commande non réelle", label_ar: "", short_fr: "", short_ar: "", sort_order: 1, is_active: true, requires_note: false, created_at: "", updated_at: "" }] }),
}));

import { ControlRoom } from "../ControlRoom";

function agent(o: Partial<DayAgent> & { agent_id: string; name: string }): DayAgent {
  return { avatar_url: null, phone: null, last_seen_at: null, is_available: false, last_action_at: "2026-10-03T15:00:00Z", active_7d: true, events: [], up: 0, rej: 0, att: 0, assigned: [], queue: [], ...o };
}

/** Saturday 3 Oct 2026, 17:20 in Tripoli. */
const DAY: TeamDay = {
  market_id: LY, day: "2026-10-03", today: "2026-10-03", tz: "Africa/Tripoli", live: true, now_min: 1040, computed_at: "2026-10-03T15:20:00Z",
  last_order_at: "2026-10-03T15:00:00Z",
  settings: { call_delay_hours: 2, idle_minutes: 30, late_minutes: 15, shift: { start: "14:00", end: "21:00", days: [6, 0, 1, 2, 3, 4] }, overrides: null },
  team: { received: 103, received_last_at: "2026-10-03T15:00:00Z", delivered: 6 },
  agents: [
    agent({ agent_id: "t", name: "tasnim", events: [[900, "a"], [1030, "a"]], up: 8, rej: 8, att: 59, assigned: [[790, 20, 0], [911, 200, 0]], queue: [["a", 300, 1], ["p", 246, 0], ["p", 60, 0], ["cf", 500, 1]] }),
    agent({ agent_id: "s", name: "salima", events: [[880, "a"], [990, "r"]], up: 5, rej: 5, att: 30, last_seen_at: "2026-10-03T15:19:00Z" }),
    agent({ agent_id: "h", name: "hend", active_7d: false, last_action_at: "2026-09-16T12:00:00Z", queue: [["cf", 9000, 1]] }),
  ],
};

const FUNNEL: TeamFunnel = {
  market_id: LY, from: "2026-09-04", to: "2026-10-03", prev_from: "2026-08-05", prev_to: "2026-09-03", tz: "Africa/Tripoli",
  agents: [
    { agent_id: "t", name: "tasnim", avatar_url: null, is_active: true, last_action_at: "2026-10-03T15:00:00Z", assigned: 555, uploaded: 248, delivered: 144, en_route: 11, returned: 86, open: 16, prev_assigned: 285, prev_delivered: 66 },
    { agent_id: "s", name: "salima", avatar_url: null, is_active: true, last_action_at: "2026-10-03T15:00:00Z", assigned: 475, uploaded: 197, delivered: 76, en_route: 16, returned: 102, open: 8, prev_assigned: 269, prev_delivered: 38 },
  ],
};

const PANEL: AgentPanel = {
  market_id: LY, agent_id: "t", from: "2026-10-03", to: "2026-10-03", today: "2026-10-03", tz: "Africa/Tripoli",
  products: [{ product_id: "m", name: "مصحف التهجد", image_url: null, assigned: 16, uploaded: 5, rejected: 3, attempts: 23 }],
  rejections: [{ group: "commande_invalide", n: 3 }],
  delivered_30: { delivered: 144, returned: 86, en_route: 11 },
  commission: {
    currency: "LYD", enabled: true, rate: 10, rate_since: "2026-09-30", balance: 363, earned: 1074, earned_n: 118, back: 144, back_n: 16, paid: 567, paid_n: 2, entries: 136,
    days: [{ day: "2026-10-02", net: 10, paid: 0 }, { day: "2026-10-03", net: 10, paid: 0 }], sum_14: 20, in_flight: 10, in_flight_late: 6, coming: 100,
    last_payout: { at: "2026-09-26T10:00:00Z", amount: 267 },
  },
};

function mount(role: "super_admin" | "market_manager" = "super_admin") {
  render(
    <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="UTC">
      <ControlRoom marketId={LY} locale="fr" tz="Africa/Tripoli" role={role} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T15:20:00Z"));
  nav.qs = "";
  nav.replace.mockReset();
  data.day = DAY;
  data.funnel = FUNNEL;
  data.panel = PANEL;
});
afterEach(() => vi.useRealTimers());

/** A strip cell, found by its label (the first match: column heads repeat some labels). */
const cellOf = (label: string) => screen.getAllByText(label)[0].parentElement as HTMLElement;

describe("Salle de contrôle — the day", () => {
  it("the strip: who works, what came in, what moved, what waits too long", () => {
    mount();
    expect(screen.getByText(/En direct/)).toHaveTextContent("En direct · 17:20");
    expect(cellOf("Agents actifs")).toHaveTextContent("1/ 2");
    expect(cellOf("Agents actifs")).toHaveTextContent("1 sans appel");
    expect(cellOf("Reçues")).toHaveTextContent("103");
    expect(cellOf("Reçues")).toHaveTextContent("dernière à 17:00");
    expect(cellOf("Uploadées")).toHaveTextContent("13");
    expect(cellOf("Uploadées")).toHaveTextContent("taux 50 %");
    expect(cellOf("Livrées")).toHaveTextContent("6");
    const unc = cellOf("Non appelées > 2 h");
    expect(unc).toHaveTextContent("1");
    expect(unc).toHaveTextContent("4 h 06 au plus · tasnim");
  });

  it("each agent: state in words, done vs left, the four numbers, the amber tag", () => {
    mount();
    const table = screen.getAllByRole("table")[0];
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByText(/tasnim|salima/).textContent)).toEqual(["tasnim", "salima"]);
    expect(rows[0]).toHaveTextContent("Au travail · appel il y a 10 min");
    expect(rows[0]).toHaveTextContent("1 confirmée non uploadée");
    expect(rows[0]).toHaveTextContent("8 upl. · 8 rej.");
    expect(rows[0]).toHaveTextContent("1 en cours · 2 à appeler");
    expect(rows[0]).toHaveTextContent("1 > 2 h");
    expect(rows[1]).toHaveTextContent("Sans appel depuis 50 min");
    // No phone in Accès: the button says so instead of opening nothing.
    expect(within(rows[0]).getByRole("button", { name: "Aucun numéro — à saisir dans Accès" })).toBeDisabled();
  });

  it("accounts silent for a week sit on one line, with what they still hold", () => {
    mount();
    expect(screen.getByText("1 compte sans appel depuis plus de 7 jours")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hend · 1 confirmée non uploadée/ })).toBeInTheDocument();
  });

  it("orders that stopped arriving put a banner on top", () => {
    data.day = { ...DAY, last_order_at: "2026-09-29T15:30:00Z" };
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Aucune commande reçue depuis 3 j 23 h");
    expect(cellOf("Reçues")).toHaveTextContent("aucune depuis 3 j 23 h");
  });

  it("a past day: no live chip, and late calls are counted on that day's assignments", () => {
    nav.qs = "day=2026-10-01";
    data.day = { ...DAY, day: "2026-10-01", live: false, now_min: null };
    mount();
    expect(screen.getByText("Journée terminée")).toBeInTheDocument();
    expect(cellOf("Appelées > 2 h")).toHaveTextContent("1");
    expect(cellOf("Appelées > 2 h")).toHaveTextContent("sur 2 attribuées ce jour");
    expect(screen.getByRole("button", { name: "Revenir à aujourd'hui" })).toBeInTheDocument();
  });

  it("stepping back a day and clicking an agent go through the URL", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Jour précédent" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/fr/team?day=2026-10-02", { scroll: false });
    await userEvent.click(within(screen.getAllByRole("table")[0]).getAllByRole("row")[1]);
    expect(nav.replace).toHaveBeenLastCalledWith("/fr/team?agent=t", { scroll: false });
  });
});

describe("Salle de contrôle — the agents over a period", () => {
  it("ranks by delivered per 100 assigned, with the trend and the balance", () => {
    mount();
    const table = screen.getAllByRole("table")[1];
    const rows = within(table).getAllByRole("row").slice(2);
    expect(rows[0]).toHaveTextContent("tasnim");
    expect(rows[0]).toHaveTextContent("26/100");
    expect(rows[0]).toHaveTextContent("▲ 3");
    expect(rows[0]).toHaveTextContent("payé le 26 sept.");
    expect(rows[1]).toHaveTextContent("jamais payé");
    expect(screen.getByText("À payer").parentElement).toHaveTextContent("795");
  });

  it("the owner's addition: a month, or any dates", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: "Mois" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/fr/team?periode=month%3A2026-09", { scroll: false });
  });

  it("a month reads as the band's title and compares with the month before", () => {
    nav.qs = "periode=month:2026-09";
    data.funnel = { ...FUNNEL, from: "2026-09-01", to: "2026-09-30", prev_from: "2026-08-01", prev_to: "2026-08-31" };
    mount();
    expect(screen.getByText("Agents · septembre 2026")).toBeInTheDocument();
    expect(screen.getByText("vs mois d'avant")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Mois" })).toHaveValue("2026-09");
    expect(screen.getByText("▲ 3")).toHaveAttribute("title", "août 2026 : 23");
  });
});

describe("Salle de contrôle — the agent panel", () => {
  it("opens from the URL with her numbers, products, rejection groups and commission", async () => {
    nav.qs = "agent=t";
    mount();
    const panel = screen.getByRole("dialog", { name: "tasnim" });
    expect(within(panel).getByText("Assignées").parentElement).toHaveTextContent("16");
    expect(within(panel).getByText("Ses uploads des 30 derniers jours").parentElement).toHaveTextContent("144 livrées");
    expect(within(panel).getByText("La journée")).toBeInTheDocument();
    expect(within(panel).getByText("Commande non réelle")).toBeInTheDocument();
    expect(within(panel).getByText("Solde à payer").parentElement).toHaveTextContent("363");
    expect(within(panel).getByText(/dont 6 retardés/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("tab", { name: "7 jours" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/fr/team?agent=t&dper=week", { scroll: false });
    await userEvent.click(within(panel).getByRole("button", { name: "Fermer" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/fr/team", { scroll: false });
  });

  it("a market manager records payouts too (canManageCommissions), from the table and the panel", () => {
    nav.qs = "agent=t";
    mount("market_manager");
    expect(screen.getAllByRole("button", { name: "Payer" })).toHaveLength(3);
  });
});
