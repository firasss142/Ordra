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
  correctionNoteBeforeStart: "commande {id} téléversée avant l'activation de ta commission",
  reasonBeforeStart: "téléversée avant l'activation de ta commission", reasonNotDelivered: "n'était plus livrée",
  paymentReceived: "Paiement reçu", adjustment: "Ajustement", empty: "Rien pour l'instant", rule: "règle",
  disabledTitle: "Les commissions ne sont pas activées pour ton compte.", disabledHint: "hint", loadError: "erreur", more: "Voir plus",
  buckets: { all: "Tout", accrual: "Livrées", reversal: "Corrections", payout: "Paiements", adjustment: "Ajustements" },
  cols: { type: "Type", detail: "Détail", date: "Date", amount: "Montant" },
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

  it("says why an order was taken back when it was uploaded before the commission started", () => {
    mount({ ...ME, history: [
      { type: "day", day: "2026-09-14", delivered: 1, corrections: 1, amount: 9, orders: [
        { external_id: "LY-20001", product_name: "Dibio", city: "Tripoli", amount: 9, entry_type: "accrual", reason: null },
        { external_id: "LY-20002", product_name: "Dibio", city: "Tripoli", amount: 9, entry_type: "accrual", reason: null },
        { external_id: "LY-20002", product_name: "Dibio", city: "Tripoli", amount: -9, entry_type: "reversal", reason: "uploaded_before_activation" },
      ] },
      { type: "day", day: "2026-09-13", delivered: 0, corrections: 1, amount: -9, orders: [
        { external_id: "LY-20003", product_name: "Dibio", city: "Sirte", amount: -9, entry_type: "reversal", reason: "uploaded_before_activation" },
      ] },
    ] });
    // A correction-only day names the order and the real reason, not "n'était pas livrée".
    expect(screen.getByText("commande #LY-20003 téléversée avant l'activation de ta commission")).toBeTruthy();
    expect(screen.queryByText(/n'était pas livrée/)).toBeNull();
    // A mixed day carries the reason under its count, and the expanded line says it too.
    expect(screen.getByText("1 correction · téléversée avant l'activation de ta commission")).toBeTruthy();
    fireEvent.click(screen.getByText("1 livrée"));
    expect(screen.getByText(/#LY-20002 · Dibio · Tripoli · téléversée avant l'activation/)).toBeTruthy();
  });

  it("explains a disabled account instead of showing zeros", () => {
    mount({ ...ME, enabled: false, balance: 0, history: [] });
    expect(screen.getByText(/ne sont pas activées/)).toBeTruthy();
    expect(screen.queryByText("À recevoir")).toBeNull();
  });
});

/**
 * Revision 2 (2026-09-18): the page takes the delivery page's charpente —
 * a bucket strip by entry type over a ruled list with column heads.
 */
describe("AgentCommissionsView — entry-type buckets", () => {
  it("offers one segment per entry type, with its count", () => {
    mount();
    const strip = screen.getByRole("tablist", { name: /Tout|Type/i });
    expect(strip).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Livrées/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Corrections/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Paiements/ })).toBeTruthy();
  });

  it("filters the list down to the chosen entry type", () => {
    mount();
    expect(screen.getByText("Paiement reçu")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Livrées/ }));
    // Only the accrual day survives; the payout and the correction day go.
    expect(screen.queryByText("Paiement reçu")).toBeNull();
    expect(screen.getByText("2 livrées")).toBeTruthy();
  });

  it("still expands a day to its orders once filtered", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Livrées/ }));
    fireEvent.click(screen.getByText("2 livrées"));
    expect(screen.getByText(/LY-10432/)).toBeTruthy();
  });

  it("marks each row with its entry type so the colour is not the only signal", () => {
    mount();
    const tags = screen.getAllByTestId("commission-entry");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.map((t) => t.getAttribute("data-entry"))).toContain("payout");
  });
});
