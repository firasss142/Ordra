import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { MyFeedbackRow, FeedbackTopic } from "@/types/feedback";

const TOPICS: FeedbackTopic[] = [
  { id: "t-card", category: "objection", key: "card", label_fr: "Veut payer par carte ou virement", label_ar: "x", sort_order: 2 },
  { id: "t-never", category: "reclamation", key: "never", label_fr: "Jamais reçu", label_ar: "x", sort_order: 2 },
];
const row = (id: string, over: Partial<MyFeedbackRow>): MyFeedbackRow => ({
  id, created_at: "2026-09-30T08:42:00Z", category: "objection", topic_id: "t-card", body: "قال اريد الدفع بالبطاقة",
  moment: "call", status: null, product: { id: "p-d", name: "كتاب الداء والدواء", image_url: null }, ...over,
});
const ROWS = [
  row("m1", {}),
  row("m2", { created_at: "2026-09-30T07:15:00Z", category: "reclamation", topic_id: "t-never", body: "حاجزه وموصلتهاش الاوله", moment: "after", status: "open" }),
  row("m3", { created_at: "2026-09-29T15:03:00Z", body: "زبون قالي توا معنديش فلوس", moment: "transit", topic_id: null }),
  row("m4", { created_at: "2026-09-27T12:00:00Z", category: "suggestion", topic_id: null, body: "تبي رواية قالون", product: null }),
];

const openCapture = vi.fn();
vi.mock("@/hooks/useFeedback", () => ({
  useMyFeedback: () => ({ rows: ROWS, error: null, isLoading: false }),
  useFeedbackTopics: () => TOPICS,
}));
vi.mock("../FeedbackCaptureProvider", () => ({
  useFeedbackCapture: () => ({ enabled: true, openCapture, captureOpen: false }),
}));

import { AgentFeedbackSheet } from "../AgentFeedbackSheet";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  openCapture.mockReset();
});
afterEach(() => vi.useRealTimers());

const mount = () =>
  render(<NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli"><AgentFeedbackSheet marketId="m-ly" /></NextIntlClientProvider>);
const bodies = () => screen.getAllByTestId("mine-row").map((r) => within(r).getByTestId("mine-words").textContent);

describe("AgentFeedbackSheet — « Mes retours »", () => {
  it("lists the agent's entries with the prototype's columns, newest first", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Voix du client" })).toBeInTheDocument();
    for (const col of ["Date", "Catégorie", "Ses mots · sujet", "Produit", "Moment", "Statut"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeInTheDocument();
    }
    expect(bodies()).toEqual(["قال اريد الدفع بالبطاقة", "حاجزه وموصلتهاش الاوله", "زبون قالي توا معنديش فلوس", "تبي رواية قالون"]);
    const first = screen.getAllByTestId("mine-row")[0];
    expect(first).toHaveTextContent("Aujourd'hui");
    expect(first).toHaveTextContent("Veut payer par carte ou virement");
    expect(screen.getAllByTestId("mine-row")[2]).toHaveTextContent("Hier");
    expect(screen.getAllByTestId("mine-row")[1]).toHaveTextContent("Ouverte");
    expect(screen.getByText("4 sur 4")).toBeInTheDocument();
  });

  it("filters by category and by moment, with counts", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Réclamation 1/ }));
    expect(bodies()).toEqual(["حاجزه وموصلتهاش الاوله"]);
    fireEvent.click(screen.getByRole("button", { name: /Tous 4/ }));
    fireEvent.click(screen.getByRole("button", { name: /En attente · en route 1/ }));
    expect(bodies()).toEqual(["زبون قالي توا معنديش فلوس"]);
    expect(screen.getByText("1 sur 4")).toBeInTheDocument();
  });

  it("searches inside the words; « / » focuses the search", () => {
    mount();
    fireEvent.keyDown(document.body, { key: "/" });
    const search = screen.getByPlaceholderText("Rechercher dans leurs mots…");
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "قالون" } });
    expect(bodies()).toEqual(["تبي رواية قالون"]);
  });

  it("« Nouveau » opens the capture window with no order", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Nouveau/ }));
    expect(openCapture).toHaveBeenCalledWith(null);
  });
});
