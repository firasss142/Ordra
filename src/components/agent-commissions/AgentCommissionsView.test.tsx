import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { AgentCommissionsView } from "./AgentCommissionsView";
import type { AgentCommissions } from "@/lib/commissions/types";

const messages = { agentCommissions: {
  title: "Mes commissions", rate: "<b>{rate}</b> par commande livrée", toReceive: "À recevoir",
  sinceLastPayout: "depuis ton paiement du <b>{date}</b> · {delivered, plural, =0 {0 livrée} one {# livrée} other {# livrées}}{corrections, plural, =0 {} one {, # correction} other {, # corrections}}",
  sinceStart: "depuis le lancement · {delivered, plural, =0 {0 livrée} one {# livrée} other {# livrées}}",
  negative: "tu as reçu {amount} de plus que ton dû", month: "Ce mois", monthDelivered: "{n, plural, =0 {0 livrée} one {# livrée} other {# livrées}}",
  inflight: "En cours", inflightCount: "{n} cmd", inflightEst: "≈ {amount} si livrées", lastPayout: "Dernier paiement", noPayout: "aucun",
  history: "Historique", historyHint: "par jour", dayDelivered: "{n, plural, =0 {0 livrée} one {# livrée} other {# livrées}}",
  dayCorrections: "{n, plural, one {# correction} other {# corrections}}", correctionNote: "commande {id} n'était pas livrée",
  paymentReceived: "Paiement reçu", adjustment: "Ajustement", empty: "Rien pour l'instant", rule: "règle",
  disabledTitle: "Les commissions ne sont pas activées pour ton compte.", disabledHint: "hint", loadError: "erreur", more: "Voir plus",
}, team: { commissions: { method: { cash: "espèces", bank_transfer: "virement", wallet: "wallet" } } } };

const ME: AgentCommissions = {
  enabled: true, currency: "LYD", rate: 3.5, balance: 29500,
  since_last_payout: { delivered: 9, corrections: 1 },
  month: { delivered: 37, earned: 129500 },
  inflight: { count: 39, est: 136500 },
  last_payout: { at: "2026-08-10T10:00:00Z", amount: 100000, method: "cash" },
  history: [
    { type: "day", day: "2026-08-16", delivered: 2, corrections: 0, amount: 7000, orders: [
      { external_id: "LY-10432", product_name: "Dibio", city: "Tripoli", amount: 3500, entry_type: "accrual" },
      { external_id: "LY-10398", product_name: "Dibio", city: "Benghazi", amount: 3500, entry_type: "accrual" },
    ] },
    { type: "day", day: "2026-08-14", delivered: 0, corrections: 1, amount: -3500, orders: [{ external_id: "LY-10290", product_name: "Dibio", city: "Zawiya", amount: -3500, entry_type: "reversal" }] },
    { type: "payout", at: "2026-08-10T10:00:00Z", amount: -100000, method: "cash", reference: "C-0812" },
  ],
  has_more: true,
};

function mount(me: AgentCommissions = ME) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AgentCommissionsView me={me} marketCode="LY" locale="fr" tz="Africa/Tripoli" onMore={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("AgentCommissionsView", () => {
  it("shows the balance as the one big number with the since-last-payout caption", () => {
    mount();
    expect(screen.getByText("À recevoir")).toBeTruthy();
    expect(screen.getByText(/9 livrées, 1 correction/)).toBeTruthy();
    expect(screen.getByText(/37 livrées/)).toBeTruthy();
    expect(screen.getByText(/39 cmd/)).toBeTruthy();
  });

  it("groups history by day and expands a day to its orders; payouts are their own row", () => {
    mount();
    expect(screen.getByText("2 livrées")).toBeTruthy();
    expect(screen.queryByText(/LY-10432/)).toBeNull();
    fireEvent.click(screen.getByText("2 livrées"));
    expect(screen.getByText(/LY-10432/)).toBeTruthy();
    expect(screen.getByText("Paiement reçu")).toBeTruthy();
    expect(screen.getAllByText(/1 correction/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Voir plus")).toBeTruthy();
  });

  it("explains a disabled account instead of showing zeros", () => {
    mount({ ...ME, enabled: false, balance: 0, history: [] });
    expect(screen.getByText(/ne sont pas activées/)).toBeTruthy();
    expect(screen.queryByText("À recevoir")).toBeNull();
  });
});
