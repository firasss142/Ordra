import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { PayoutModal } from "./PayoutModal";

const messages = {
  team: { commissions: {
    method: { cash: "espèces", bank_transfer: "virement", wallet: "wallet" },
    payout: {
      title: "Enregistrer un paiement — {name}", hint: "Solde actuel {balance}",
      amount: "Montant ({currency})", date: "Date du paiement", method: "Mode", reference: "Référence", note: "Note", optional: "(optionnel)",
      refPlaceholder: "réf", notePlaceholder: "note", after: "Solde après paiement",
      warn: "Dépasse : {after}", confirmNegative: "Je confirme ce paiement au-delà du solde",
      cancel: "Annuler", save: "Enregistrer", saving: "…", saved: "ok", failed: "ko", invalid: "invalide",
    },
  } },
};

function mount(over: Partial<React.ComponentProps<typeof PayoutModal>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ ok: true });
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <PayoutModal
        open
        agent={{ id: "a1", name: "tasnim", balance: 29500 }}
        marketCode="LY"
        currency="LYD"
        tz="Africa/Tripoli"
        locale="fr"
        onClose={() => {}}
        onSubmit={onSubmit}
        {...over}
      />
    </NextIntlClientProvider>,
  );
  return { onSubmit };
}

beforeEach(() => vi.clearAllMocks());

describe("PayoutModal", () => {
  it("prefills the amount with the positive balance and shows a zero balance after", () => {
    mount();
    const amount = screen.getByLabelText(/Montant/) as HTMLInputElement;
    expect(amount.value).toBe("29500");
    expect(screen.queryByText(/Je confirme/)).toBeNull();
  });

  it("warns and requires an explicit confirm when the amount exceeds the balance", async () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText(/Montant/), { target: { value: "30000" } });
    expect(screen.getByText(/Dépasse/)).toBeTruthy();
    fireEvent.click(screen.getByText("Enregistrer"));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/Je confirme/));
    fireEvent.click(screen.getByText("Enregistrer"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ agent_id: "a1", amount: 30000, method: "cash", allow_negative: true });
  });

  it("submits without the flag when the balance stays ≥ 0", async () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText(/Montant/), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText(/Mode/), { target: { value: "bank_transfer" } });
    fireEvent.click(screen.getByText("Enregistrer"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ amount: 20000, method: "bank_transfer", allow_negative: false });
    expect(typeof onSubmit.mock.calls[0][0].paid_at).toBe("string");
  });
});
