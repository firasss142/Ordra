import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { FeedbackContext, FeedbackLookupResult, FeedbackTopic } from "@/types/feedback";

const ORDER = "11111111-1111-4111-8111-111111111111";
const TOPICS: FeedbackTopic[] = [
  { id: "t-never", category: "reclamation", key: "never", label_fr: "Jamais reçu", label_ar: "لم يصل", sort_order: 2 },
  { id: "t-card", category: "objection", key: "card", label_fr: "Veut payer par carte ou virement", label_ar: "يريد الدفع", sort_order: 2 },
  { id: "t-nocash", category: "objection", key: "nocash", label_fr: "Pas de cash maintenant", label_ar: "لا يملك", sort_order: 1 },
];
const CONTEXT: FeedbackContext = {
  order: {
    id: ORDER, ref: "39508", status: "pending", moment: "call", customer_id: "c1",
    customer_name: "فاطمة المقريف", customer_phone: "092 611 0387",
    product: { id: "p-d", name: "كتاب الداء والدواء", image_url: "https://img/d.jpeg" },
  },
  history: { count: 2, open: 1, quote: "حاجزه وموصلتهاش الاوله" },
};
const LOOKUP: FeedbackLookupResult = {
  customers: [{ id: "c-fathi", name: "فتحي المبروك", phone: "092 640 1175", city: "طرابلس", orders: 2, latest_order_id: "o-road" }],
  orders: [
    { id: "o-delivered", ref: "39340", customer_id: "c-fathi", customer_name: "فتحي المبروك", customer_phone: "092 640 1175",
      status: "delivered", moment: "after", product: { id: "p-bag", name: "Sac de frappe · moyen", image_url: null }, status_at: "2026-09-27T09:00:00Z" },
    { id: "o-road", ref: "39412", customer_id: "c-fathi", customer_name: "فتحي المبروك", customer_phone: "092 640 1175",
      status: "out_for_delivery", moment: "transit", product: null, status_at: null },
  ],
};

const createFeedback = vi.fn();
let lookupQuery = "";
vi.mock("@/hooks/useFeedback", () => ({
  useFeedbackTopics: () => TOPICS,
  useFeedbackContext: (id: string | null) => ({ context: id ? CONTEXT : null, isLoading: false, error: null }),
  useFeedbackLookup: (q: string) => { lookupQuery = q; return { result: q.trim().length >= 3 ? LOOKUP : null, isLoading: false }; },
  createFeedback: (...a: unknown[]) => createFeedback(...a),
}));

let phone = false;
vi.mock("@/components/agent/shared", async (orig) => ({
  ...(await orig<typeof import("@/components/agent/shared")>()),
  useAgentPhone: () => phone,
}));

import { CaptureDialog } from "../CaptureDialog";

function mount(orderId: string | null = ORDER) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <CaptureDialog orderId={orderId} market={null} onClose={onClose} onSaved={onSaved} />
    </NextIntlClientProvider>,
  );
  return { onClose, onSaved };
}

beforeEach(() => {
  createFeedback.mockReset();
  createFeedback.mockResolvedValue({ id: "fb1", moment: "call", category: "objection", status: null });
  lookupQuery = "";
  phone = false;
});

describe("CaptureDialog — linked to the order on screen", () => {
  it("shows the order, the derived moment and what this customer already said", () => {
    mount();
    expect(screen.getByRole("dialog", { name: "Ce que dit le client" })).toBeInTheDocument();
    expect(screen.getByText("فاطمة المقريف")).toBeInTheDocument();
    const card = screen.getByText("فاطمة المقريف").parentElement!;
    expect(card).toHaveTextContent("092 611 0387 · Commande #39508 · كتاب الداء والدواء");
    expect(screen.getByTestId("moment-row")).toHaveTextContent("Moment : Appel de confirmation");
    expect(screen.getByTestId("moment-row")).toHaveTextContent("auto");
    expect(screen.getByTestId("moment-row")).toHaveTextContent("déduit du statut « En attente »");
    expect(screen.getByTestId("moment-row")).toHaveTextContent("Ce client a déjà 2 retours · 1 réclamation ouverte");
    expect(screen.getByText("حاجزه وموصلتهاش الاوله")).toBeInTheDocument();
  });

  it("keys 1–3 pick the category, topics follow it, and nothing saves without words", async () => {
    mount();
    const save = screen.getByRole("button", { name: /^Enregistrer/ });
    expect(screen.getByText("Choisissez d'abord une catégorie")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.keyDown(document.body, { code: "Digit2", key: "2" });
    expect(screen.getByRole("button", { name: /Objection/, pressed: true })).toBeInTheDocument();
    // objection topics only, in their order
    expect(screen.queryByRole("button", { name: "Jamais reçu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Veut payer par carte ou virement" }));
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Ce qu'il a dit/), { target: { value: "قال اريد الدفع بالبطاقة" } });
    expect(save).toBeEnabled();
    expect(screen.getByText("23 / 2000")).toBeInTheDocument();
  });

  it("Ctrl+Enter saves — order linked, no moment sent", async () => {
    const { onSaved } = mount();
    fireEvent.keyDown(document.body, { code: "Digit2", key: "2" });
    fireEvent.change(screen.getByPlaceholderText(/Ce qu'il a dit/), { target: { value: "قال اريد الدفع بالبطاقة" } });
    await act(async () => { fireEvent.keyDown(screen.getByPlaceholderText(/Ce qu'il a dit/), { key: "Enter", ctrlKey: true }); });
    expect(createFeedback).toHaveBeenCalledWith({
      category: "objection", body: "قال اريد الدفع بالبطاقة", topic_id: null, order_id: ORDER, market_id: null,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "fb1", category: "objection", moment: "call", topic: null }));
  });

  it("a réclamation says it will be followed to resolution", () => {
    mount();
    fireEvent.keyDown(document.body, { code: "Digit1", key: "1" });
    expect(screen.getByText(/Une réclamation est suivie jusqu'à sa résolution/)).toBeInTheDocument();
  });

  it("Escape closes", () => {
    const { onClose } = mount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("a failed save says so and keeps the words", async () => {
    createFeedback.mockRejectedValueOnce(new Error("boom"));
    mount();
    fireEvent.keyDown(document.body, { code: "Digit3", key: "3" });
    fireEvent.change(screen.getByPlaceholderText(/Ce qu'il a dit/), { target: { value: "أعجبته الخدمة" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Enregistrer/ })); });
    expect(await screen.findByRole("alert")).toHaveTextContent("L'enregistrement a échoué");
    expect(screen.getByPlaceholderText(/Ce qu'il a dit/)).toHaveValue("أعجبته الخدمة");
  });
});

describe("CaptureDialog — the customer calls back (no order open)", () => {
  it("searches by the number, lists orders with their moment, and picking one sets it", async () => {
    mount(null);
    expect(screen.getByText("Appel entrant")).toBeInTheDocument();
    expect(screen.getByText("Tapez le numéro qui s'affiche sur votre téléphone")).toBeInTheDocument();
    expect(screen.getByText(/choisissez la commande pour situer le moment/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Numéro, nom ou n° de commande…"), { target: { value: "0926" } });
    expect(lookupQuery).toBe("0926");
    expect(screen.getByText("Clients")).toBeInTheDocument();
    expect(screen.getByText("2 commandes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /#39340/ }));
    expect(screen.getByTestId("moment-row")).toHaveTextContent("Après livraison");
    expect(screen.getByTestId("moment-row")).toHaveTextContent("déduit du statut « Livré »");

    fireEvent.keyDown(document.body, { code: "Digit1", key: "1" });
    fireEvent.change(screen.getByPlaceholderText(/Ce qu'il a dit/), { target: { value: "مش نفس لي في نت" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Enregistrer/ })); });
    expect(createFeedback).toHaveBeenCalledWith(expect.objectContaining({ category: "reclamation", order_id: "o-delivered" }));
  });

  it("picking the customer picks their latest order", () => {
    mount(null);
    fireEvent.change(screen.getByPlaceholderText("Numéro, nom ou n° de commande…"), { target: { value: "0926" } });
    fireEvent.click(screen.getByRole("button", { name: /فتحي المبروك.*2 commandes/ }));
    expect(screen.getByTestId("moment-row")).toHaveTextContent("En attente · en route");
  });

  it("« Changer » from a linked order goes to the search", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Changer" }));
    expect(screen.getByPlaceholderText("Numéro, nom ou n° de commande…")).toBeInTheDocument();
  });

  it("saving with no order picked is allowed — the moment is the call", async () => {
    mount(null);
    fireEvent.keyDown(document.body, { code: "Digit3", key: "3" });
    fireEvent.change(screen.getByPlaceholderText(/Ce qu'il a dit/), { target: { value: "أعجبته الخدمة" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Enregistrer/ })); });
    expect(createFeedback).toHaveBeenCalledWith(expect.objectContaining({ category: "suggestion", order_id: null }));
  });
});

describe("CaptureDialog — the window's two forms", () => {
  it("desktop: a wide dialog with the three cards keyed 1–3 and « Ctrl ↵ » on the save", () => {
    mount();
    const dialog = screen.getByRole("dialog", { name: "Ce que dit le client" });
    expect(dialog).toHaveClass("mbox", "wide");
    expect(screen.getByRole("button", { name: /Réclamation.*un souci à régler.*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Enregistrer/ })).toHaveTextContent("Ctrl ↵");
  });

  it("phone: a bottom sheet, no keyboard hints", () => {
    phone = true;
    mount();
    const dialog = screen.getByRole("dialog", { name: "Ce que dit le client" });
    expect(dialog).toHaveClass("sheet");
    expect(screen.getByRole("button", { name: /^Enregistrer/ })).not.toHaveTextContent("Ctrl");
  });

  it("the topic chosen travels with the save", async () => {
    const { onSaved } = mount();
    fireEvent.keyDown(document.body, { code: "Digit2", key: "2" });
    fireEvent.click(screen.getByRole("button", { name: "Pas de cash maintenant" }));
    fireEvent.change(screen.getByPlaceholderText(/Ce qu'il a dit/), { target: { value: "ما عنديش" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Enregistrer/ })); });
    expect(createFeedback).toHaveBeenCalledWith(expect.objectContaining({ topic_id: "t-nocash" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ topic: "Pas de cash maintenant" })));
  });
});
