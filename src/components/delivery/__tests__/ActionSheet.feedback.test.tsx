import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

vi.mock("@/hooks/useFeedback", () => ({
  useFeedbackTopics: () => [
    { id: "t-nocash", category: "objection", key: "nocash", label_fr: "Pas de cash maintenant", label_ar: "x", sort_order: 1 },
  ],
}));

import { ActionSheet } from "../Sheets";

const NOW = Date.parse("2026-09-30T08:00:00Z");
const feedback = { remark: "زبون قالي توا معنديش فلوس", remarkClass: "no_cash", status: "out_for_delivery", marketId: "m-ly", enabled: true };

function mount(onSubmit = vi.fn(), withFeedback = true) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ActionSheet initialType="call_customer" tz="Africa/Tripoli" now={NOW} onClose={vi.fn()} onSubmit={onSubmit}
        feedback={withFeedback ? feedback : undefined} />
    </NextIntlClientProvider>,
  );
  return onSubmit;
}

describe("ActionSheet — « Pourquoi ? » on Veut annuler", () => {
  it("offers to keep why, with the courier's remark, a suggested category and the moment", () => {
    mount();
    expect(screen.queryByText("Pourquoi ? Garder ce que le client a dit")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Veut annuler" }));
    expect(screen.getByText("Pourquoi ? Garder ce que le client a dit")).toBeInTheDocument();
    expect(screen.getByText("« زبون قالي توا معنديش فلوس »")).toBeInTheDocument();
    expect(screen.getByTestId("moment-row")).toHaveTextContent("En attente · en route");
    // the note is relabelled — it becomes the customer's words
    expect(screen.getByText("Ses mots")).toBeInTheDocument();
  });

  it("needs the words while it is on, and sends the category with the action", () => {
    const onSubmit = mount();
    fireEvent.click(screen.getByRole("button", { name: "Veut annuler" }));
    const save = screen.getByRole("button", { name: "Enregistrer l'action" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(fr.delivery.sheet.notePlaceholder), { target: { value: "قال توا معنديش فلوس" } });
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "reached_wants_cancel", note: "قال توا معنديش فلوس", feedback: { category: "objection", topic_id: "t-nocash" },
    }));
  });

  it("switched off, the action goes alone and the note is optional again", () => {
    const onSubmit = mount();
    fireEvent.click(screen.getByRole("button", { name: "Veut annuler" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'action" }));
    expect(onSubmit.mock.calls[0][0].feedback).toBeUndefined();
  });

  it("never offered on other outcomes, nor where capture is not available", () => {
    mount(vi.fn(), false);
    fireEvent.click(screen.getByRole("button", { name: "Veut annuler" }));
    expect(screen.queryByText("Pourquoi ? Garder ce que le client a dit")).toBeNull();
  });
});
