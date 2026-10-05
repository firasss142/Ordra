import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { MyFeedbackRow, FeedbackTopic } from "@/types/feedback";

const LY = "00000000-0000-0000-0000-000000000002";
const TOPICS: FeedbackTopic[] = [
  { id: "t-card", category: "objection", key: "card", label_fr: "Veut payer par carte", label_ar: "x", sort_order: 2 },
  { id: "t-never", category: "reclamation", key: "never", label_fr: "Jamais reçu", label_ar: "x", sort_order: 2 },
];
const row = (id: string, over: Partial<MyFeedbackRow>): MyFeedbackRow => ({
  id, created_at: "2026-09-30T08:42:00Z", category: "objection", topic_id: "t-card", body: "قال اريد الدفع بالبطاقة",
  moment: "call", status: null, product: { id: "p-d", name: "كتاب الداء والدواء", image_url: null },
  customer_name: "فاطمة المقريف", order_ref: "39508", ...over,
});
const ROWS = [
  row("m1", {}),
  row("m2", { created_at: "2026-09-30T07:15:00Z", category: "reclamation", topic_id: "t-never", body: "حاجزه وموصلتهاش الاوله", moment: "after", status: "open", product: { id: "p-s", name: "Sac de frappe", image_url: null } }),
  row("m3", { created_at: "2026-09-29T15:03:00Z", body: "زبون قالي توا معنديش فلوس", moment: "transit", topic_id: null, customer_name: null, order_ref: null }),
  row("m4", { created_at: "2026-09-27T12:00:00Z", category: "suggestion", topic_id: null, body: "تبي رواية قالون", product: null, status: null }),
];

let rows: MyFeedbackRow[] | null = ROWS;
let phone = false;
const openCapture = vi.fn();
vi.mock("@/hooks/useFeedback", () => ({
  useMyFeedback: () => ({ rows, error: null, isLoading: rows === null }),
  useFeedbackTopics: () => TOPICS,
}));
vi.mock("@/components/feedback/FeedbackCaptureProvider", () => ({
  useFeedbackCapture: () => ({ enabled: true, openCapture, captureOpen: false }),
}));
vi.mock("@/components/agent/shared", async (orig) => ({
  ...(await orig<typeof import("@/components/agent/shared")>()),
  useAgentPhone: () => phone,
}));

import { VocPage } from "../VocPage";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  openCapture.mockReset();
  rows = ROWS;
  phone = false;
});
afterEach(() => vi.useRealTimers());

const mount = () =>
  render(<NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli"><VocPage marketId={LY} /></NextIntlClientProvider>);
const words = () => screen.getAllByTestId("voc-row").map((r) => within(r).getByTestId("voc-words").textContent);

describe("VocPage — desktop", () => {
  it("lists the agent's entries in the prototype's columns, newest first", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Voix du client" })).toBeInTheDocument();
    for (const col of ["Date", "Catégorie", "Ses mots · sujet", "Produit", "Moment", "Statut"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeInTheDocument();
    }
    expect(words()).toEqual(["« قال اريد الدفع بالبطاقة »", "« حاجزه وموصلتهاش الاوله »", "« زبون قالي توا معنديش فلوس »", "« تبي رواية قالون »"]);
    const [first, second, third] = screen.getAllByTestId("voc-row");
    expect(first).toHaveTextContent("Aujourd'hui 10:42");
    expect(first).toHaveTextContent("Objection");
    expect(first).toHaveTextContent("Veut payer par carte · فاطمة المقريف · #39508");
    expect(first).toHaveTextContent("كتاب الداء والدواء");
    expect(first).toHaveTextContent("Appel de confirmation");
    expect(second).toHaveTextContent("Réclamation");
    expect(second).toHaveTextContent("Ouverte");
    expect(second).toHaveTextContent("Après livraison");
    expect(third).toHaveTextContent("Hier 17:03");
    expect(screen.getByText("4 sur 4")).toBeInTheDocument();
  });

  it("the category tabs carry their counts and filter", () => {
    mount();
    expect(screen.getByRole("tab", { name: /Tous\s*4/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Réclamation\s*1/ }));
    expect(words()).toEqual(["« حاجزه وموصلتهاش الاوله »"]);
    expect(screen.getByText("1 sur 4")).toBeInTheDocument();
  });

  it("the moments are a multi-select", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "En attente · en route" }));
    expect(words()).toEqual(["« زبون قالي توا معنديش فلوس »"]);
    fireEvent.click(screen.getByRole("button", { name: "Après livraison" }));
    expect(words()).toEqual(["« حاجزه وموصلتهاش الاوله »", "« زبون قالي توا معنديش فلوس »"]);
    fireEvent.click(screen.getByRole("button", { name: "En attente · en route" }));
    expect(words()).toEqual(["« حاجزه وموصلتهاش الاوله »"]);
  });

  it("searches their words, the subject and the product; « / » focuses the field", () => {
    mount();
    fireEvent.keyDown(document.body, { key: "/" });
    const search = screen.getByPlaceholderText("Rechercher dans leurs mots…");
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "قالون" } });
    expect(words()).toEqual(["« تبي رواية قالون »"]);
    fireEvent.change(search, { target: { value: "jamais" } });
    expect(words()).toEqual(["« حاجزه وموصلتهاش الاوله »"]);
    fireEvent.change(search, { target: { value: "sac de" } });
    expect(words()).toEqual(["« حاجزه وموصلتهاش الاوله »"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("Aucun retour pour ce filtre.")).toBeInTheDocument();
  });

  it("« Nouveau » opens the capture with no order", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Nouveau/ }));
    expect(openCapture).toHaveBeenCalledWith(null);
  });

  it("an agent with nothing yet is told to press F during a call", () => {
    rows = [];
    mount();
    expect(screen.getByText("Aucun retour pour l'instant. Appuyez sur F pendant un appel.")).toBeInTheDocument();
  });
});

describe("VocPage — phone: each entry is a card (plan decision 9)", () => {
  it("cards instead of the 900 px table, and the big button opens the capture", () => {
    phone = true;
    mount();
    expect(screen.queryByRole("columnheader")).toBeNull();
    const cards = screen.getAllByTestId("voc-card");
    expect(cards).toHaveLength(4);
    expect(cards[1]).toHaveTextContent("« حاجزه وموصلتهاش الاوله »");
    expect(cards[1]).toHaveTextContent("Jamais reçu · Après livraison");
    expect(cards[1]).toHaveTextContent("Ouverte");
    fireEvent.click(screen.getByRole("button", { name: "Noter ce que dit un client" }));
    expect(openCapture).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("tab", { name: /Suggestion\s*1/ }));
    expect(screen.getAllByTestId("voc-card")).toHaveLength(1);
  });
});
