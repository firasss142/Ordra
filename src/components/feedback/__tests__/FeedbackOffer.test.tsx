import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import fr from "@/messages/fr.json";
import type { FeedbackTopic } from "@/types/feedback";
import { FeedbackOffer, useFeedbackOffer, type FeedbackOfferState } from "../FeedbackOffer";

const TOPICS: FeedbackTopic[] = [
  { id: "t-nocash", category: "objection", key: "nocash", label_fr: "Pas de cash maintenant", label_ar: "x", sort_order: 1 },
  { id: "t-card", category: "objection", key: "card", label_fr: "Veut payer par carte ou virement", label_ar: "x", sort_order: 2 },
  { id: "t-nonconform", category: "reclamation", key: "nonconform", label_fr: "Non conforme à la commande", label_ar: "x", sort_order: 0 },
];

function Harness({ words, remark = null, remarkClass = null, onState }: {
  words: string; remark?: string | null; remarkClass?: string | null; onState?: (s: FeedbackOfferState) => void;
}) {
  const [text, setText] = useState(words);
  const offer = useFeedbackOffer({ topics: TOPICS, words: text, remark, remarkClass });
  onState?.(offer.state);
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
      <input aria-label="words" value={text} onChange={(e) => setText(e.target.value)} />
      <FeedbackOffer kind={remark !== null ? "delivery" : "reject"} offer={offer} topics={TOPICS} remark={remark} moment="call" status="pending" />
    </NextIntlClientProvider>
  );
}

describe("FeedbackOffer — keep what the customer said", () => {
  it("is on by default and suggests from the words (« بطاقة » → Objection · carte)", () => {
    let state: FeedbackOfferState | null = null;
    render(<Harness words="قال اريد الدفع بالبطاقة" onState={(s) => { state = s; }} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /Objection.*suggéré/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Veut payer par carte ou virement", pressed: true })).toBeInTheDocument();
    expect(state).toEqual({ on: true, category: "objection", topicId: "t-card" });
  });

  it("follows the words until the agent picks, then keeps the agent's pick", () => {
    let state: FeedbackOfferState | null = null;
    render(<Harness words="قال اريد الدفع بالبطاقة" onState={(s) => { state = s; }} />);
    fireEvent.change(screen.getByLabelText("words"), { target: { value: "قالت لا املك المبلغ" } });
    expect(state).toMatchObject({ category: "objection", topicId: "t-nocash" });
    fireEvent.click(screen.getByRole("button", { name: /Réclamation/ }));
    fireEvent.change(screen.getByLabelText("words"), { target: { value: "قال اريد الدفع بالبطاقة" } });
    expect(state).toMatchObject({ category: "reclamation", topicId: null });
  });

  it("words with no customer voice still default to an objection — a refusal is one", () => {
    let state: FeedbackOfferState | null = null;
    render(<Harness words="الغي الطلب" onState={(s) => { state = s; }} />);
    expect(state).toMatchObject({ on: true, category: "objection", topicId: null });
    expect(screen.queryByText("suggéré")).toBeNull();
  });

  it("the courier's remark is the context and drives the suggestion", () => {
    let state: FeedbackOfferState | null = null;
    render(<Harness words="" remark="مش نفس لي في نت" remarkClass="wrong_item" onState={(s) => { state = s; }} />);
    expect(screen.getByText("Le livreur a noté")).toBeInTheDocument();
    expect(screen.getByText("« مش نفس لي في نت »")).toBeInTheDocument();
    expect(state).toMatchObject({ category: "reclamation", topicId: "t-nonconform" });
  });

  it("switched off, it shows nothing more and says so", () => {
    let state: FeedbackOfferState | null = null;
    render(<Harness words="غالي" onState={(s) => { state = s; }} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(state).toMatchObject({ on: false });
    expect(screen.queryByRole("button", { name: /Objection/ })).toBeNull();
  });
});
