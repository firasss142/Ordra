import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { CommissionsCard } from "./CommissionsCard";
import { buildCommissionView } from "@/lib/commissions/view-models";
import type { TeamCommissions } from "@/lib/commissions/types";

const messages = { team: { commissions: {
  owes: "doit {amount}", disabled: "désactivée", neverPaid: "jamais payée",
  method: { cash: "espèces", bank_transfer: "virement", wallet: "wallet" },
  card: {
    title: "Commissions & paiements", hint: "taux {rate}", hintOff: "désactivées", hintNoRate: "aucun taux",
    agent: "Agent", delivered: "Livrées", earned: "Acquis (période)", paid: "Versé (période)", balance: "Solde total",
    lastPayout: "Dernier paiement", pay: "Payer", total: "Total", netNote: "net · {toPay} à payer",
    settingsLink: "Taux · Paramètres →", export: "Exporter CSV", footer: "footer", empty: "Aucun agent.",
  },
} } };

const rate = (enabled: boolean, amount = 3) => ({ amount, enabled, is_override: false, effective_from: "2026-07-27" });
const TC: TeamCommissions = {
  market_id: "m", currency: "LYD", from: "2026-08-10", to: "2026-08-16", tz: "Africa/Tripoli",
  market: { enabled: true, amount: 3, effective_from: "2026-07-27" },
  agents: [
    { agent_id: "t", name: "tasnim", avatar_url: null, is_active: true, rate: rate(true, 3.5), delivered: 23, earned: 80500, paid: 100000, pending_count: 39, pending_est: 136500, balance: 29500, earned_total: 129500, paid_total: 100000, last_payout: { at: "2026-08-10T10:00:00Z", amount: 100000, method: "cash" } },
    { agent_id: "r", name: "roqaya", avatar_url: null, is_active: true, rate: rate(true), delivered: 15, earned: 45000, paid: 0, pending_count: 0, pending_est: 0, balance: -7000, earned_total: 63000, paid_total: 70000, last_payout: null },
    { agent_id: "m", name: "mouna", avatar_url: null, is_active: true, rate: rate(false, 0), delivered: 0, earned: 0, paid: 0, pending_count: 0, pending_est: 0, balance: 0, earned_total: 0, paid_total: 0, last_payout: null },
  ],
  team: { delivered: 38, earned: 125500, paid: 100000, balance: 22500 },
};

describe("CommissionsCard", () => {
  it("renders one row per agent, a negative balance as a debt pill, a paused agent as disabled, and totals", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <CommissionsCard view={buildCommissionView(TC)} marketCode="LY" locale="fr" tz="Africa/Tripoli" canPay onPay={vi.fn()} onSelectAgent={vi.fn()} settingsHref="/fr/settings/general" exportHrefFor={() => "#"} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("tasnim")).toBeTruthy();
    expect(screen.getByText(/doit/)).toBeTruthy();
    expect(screen.getByText("désactivée")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText(/29.500.*à payer/)).toBeTruthy();
    // pay buttons only for enabled agents or agents with a balance
    expect(screen.getAllByText("Payer").length).toBe(2);
  });
});
