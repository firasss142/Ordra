import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { FeedbackOverviewResponse, FeedbackReason, FeedbackSheetRow } from "@/types/feedback";

// ── URL ──────────────────────────────────────────────────────────────────────
let search = new URLSearchParams();
// Filters never go through the router: on this force-dynamic page a router.replace is a
// server round trip and the dashboard skeleton flashes in between.
vi.spyOn(window.history, "replaceState").mockImplementation((_s, _t, url) => {
  search = new URLSearchParams(String(url ?? "").split("?")[1] ?? "");
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => "/fr/feedback",
}));

// ── data (invented agents and customers — the repo is public) ────────────────
const reason = (topicId: string, count: number, prev: number | null, over: Partial<FeedbackReason> = {}): FeedbackReason => ({
  topicId, category: "objection", count, prev, response: null,
  products: [{ id: "q", label: "القرآن تدبر وعمل", imageUrl: null, count }],
  quotes: [
    { id: `${topicId}-1`, body: `قول ${topicId} 1`, moment: "call", source: "import", author: "Rania" },
    { id: `${topicId}-2`, body: `قول ${topicId} 2`, moment: "door", source: "courier", author: null },
  ],
  ...over,
});

const OVERVIEW: FeedbackOverviewResponse = {
  today: "2026-10-06", first: "2026-05-21", from: "2026-09-07", to: "2026-10-06", preset: "d30", hasPrev: true,
  families: [
    { id: "q", label: "القرآن تدبر وعمل", imageUrl: null, productIds: ["q"] },
    { id: "h", label: "كتاب الحفظ الميسر", imageUrl: null, productIds: ["h"] },
  ],
  topics: [
    { id: "t-cash", category: "objection", key: "nocash", label_fr: "Pas de cash maintenant", label_ar: "لا يملك المبلغ الآن", sort_order: 1, response: "Rappeler le 1er du mois." },
    { id: "t-card", category: "objection", key: "card", label_fr: "Veut payer par carte ou virement", label_ar: "x", sort_order: 2, response: null },
    { id: "t-deliv", category: "objection", key: "delivery", label_fr: "Livraison (délai, ville)", label_ar: "x", sort_order: 5, response: null },
    { id: "t-version", category: "suggestion", key: "version", label_fr: "Autre version ou produit", label_ar: "x", sort_order: 0, response: null },
    { id: "t-nonconf", category: "reclamation", key: "nonconform", label_fr: "Non conforme à la commande", label_ar: "x", sort_order: 0, response: null },
  ],
  agents: [{ id: "rania", name: "Rania" }, { id: "hiba", name: "Hiba" }],
  total: 97,
  kpis: [
    { category: "objection", count: 81, prev: 27 },
    { category: "suggestion", count: 15, prev: 0 },
    { category: "reclamation", count: 1, prev: 7 },
  ],
  toCheck: 11,
  reasons: [reason("t-cash", 36, 5, { response: "Rappeler le 1er du mois." }), reason("t-card", 14, 7)],
  gone: [reason("t-deliv", 0, 2, { quotes: [], products: [] })],
  wants: [reason("t-version", 14, 0, { category: "suggestion" })],
  wantsGone: [],
  complaints: { open: 1, firstOpenId: "k1" },
};

const ROW = (id: string, over: Partial<FeedbackSheetRow> = {}): FeedbackSheetRow => ({
  id, created_at: "2026-09-28T09:00:00Z", category: "objection", topic_id: "t-cash", body: `يقول ${id}`,
  moment: "call", source: "import", status: null,
  product: { id: "q", name: "القرآن تدبر وعمل", image_url: null }, customer_name: "Cliente A", customer_phone: "0910000000",
  order_id: "o1", order_ref: "10517", author: { id: "rania", name: "Rania" }, assignee: null, ...over,
});
const COMPLAINT = ROW("k1", { category: "reclamation", topic_id: "t-nonconf", body: "Incorrect product specs", status: "open", source: "courier", author: null, moment: "transit" });
const ROWS = [ROW("a"), ROW("b", { topic_id: "t-card", product: { id: "h", name: "كتاب الحفظ الميسر", image_url: null } }), ROW("c", { topic_id: null }), COMPLAINT];

const discardFeedback = vi.fn();
const restoreFeedback = vi.fn();
const setFeedbackTopic = vi.fn();
const setTopicResponse = vi.fn();
const setComplaintStatus = vi.fn();
let rowsQuery: Record<string, unknown> = {};
vi.mock("@/hooks/useFeedback", () => ({
  useFeedbackOverview: () => ({ overview: OVERVIEW, error: null, stale: false, mutate: vi.fn() }),
  useFeedbackRows: (q: Record<string, unknown>) => { rowsQuery = q; return { rows: ROWS, total: ROWS.length, error: null, mutate: vi.fn() }; },
  useFeedbackRow: (id: string | null) => ({ row: id ? ROWS.find((r) => r.id === id) ?? null : null, mutate: vi.fn() }),
  discardFeedback: (...a: unknown[]) => discardFeedback(...a),
  restoreFeedback: (...a: unknown[]) => restoreFeedback(...a),
  setFeedbackTopic: (...a: unknown[]) => setFeedbackTopic(...a),
  setTopicResponse: (...a: unknown[]) => setTopicResponse(...a),
  setComplaintStatus: (...a: unknown[]) => setComplaintStatus(...a),
}));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: null }) }));

import { VoiceWorkspace } from "../VoiceWorkspace";

function mount() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <VoiceWorkspace role="market_manager" marketId="00000000-0000-0000-0000-000000000002" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  search = new URLSearchParams();
  for (const f of [restoreFeedback, setFeedbackTopic, setTopicResponse, setComplaintStatus]) f.mockReset().mockResolvedValue({ count: 1 });
  discardFeedback.mockReset().mockImplementation(async (ids: string[]) => ({ count: ids.length }));
});

describe("VoiceWorkspace — header", () => {
  it("opens on the sheet; Raisons is the second tab", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Voix du client" })).toBeTruthy();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Feuille", "Raisons"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tabs[1]);
    expect(search.get("tab")).toBe("raisons");
  });

  it("the product filter narrows the data and lands in the URL", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Produit\s*Tous/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "كتاب الحفظ الميسر" }));
    expect(search.get("prod")).toBe("h");
    expect(rowsQuery.family).toBe("h");
  });
});

describe("VoiceWorkspace — Raisons", () => {
  beforeEach(() => { search = new URLSearchParams("tab=raisons"); });

  it("one sentence and the to-do line", () => {
    mount();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Sur 97 retours, 81 expliquent pourquoi ils n'achètent pas. La 1re raison : pas de cash maintenant.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /1 réclamation ouverte/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /11 à vérifier/ })).toBeTruthy();
  });

  it("a ranked list; the first reason starts open with its quotes, products and answer", () => {
    mount();
    const cash = screen.getByRole("button", { name: /Pas de cash maintenant/ });
    expect(cash.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("قول t-cash 1")).toBeTruthy();
    expect(screen.getByText("dit à Rania · pendant l'appel")).toBeTruthy();
    expect(screen.getByText("dit à livreur Darb · à la porte")).toBeTruthy();
    expect(screen.getByText("Rappeler le 1er du mois.")).toBeTruthy();
    expect(screen.getByText("Plus mentionné ces 30 jours : Livraison (délai, ville)")).toBeTruthy();
  });

  it("opening another reason closes the first; an answered reason says so when closed", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Veut payer par carte/ }));
    const cash = screen.getByRole("button", { name: /Pas de cash maintenant/ });
    expect(cash.getAttribute("aria-expanded")).toBe("false");
    expect(within(cash).getByText("Notre réponse")).toBeTruthy();
    expect(screen.queryByText("قول t-cash 1")).toBeNull();
    expect(screen.getByText("قول t-card 1")).toBeTruthy();
  });

  it("« Écrire notre réponse » saves through the API", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Veut payer par carte/ }));
    fireEvent.click(screen.getByRole("button", { name: "Écrire notre réponse" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Proposer le virement à la livraison." } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enregistrer" })); });
    expect(setTopicResponse).toHaveBeenCalledWith("t-card", "Proposer le virement à la livraison.");
  });

  it("« Voir les 36 dans la feuille » opens the sheet on that reason", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Voir les 36 dans la feuille/ }));
    expect(search.get("tab")).toBeNull();
    expect(search.get("only")).toBe("t-cash");
  });

  it("« 1 réclamation ouverte » opens it in the drawer", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /1 réclamation ouverte/ }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Incorrect product specs")).toBeTruthy();
  });
});

describe("VoiceWorkspace — the sheet", () => {
  it("four minis and the saved views with their counts", () => {
    mount();
    const views = screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }))
      .filter((b) => b.classList.contains("vw")).map((b) => b.textContent);
    expect(views).toEqual(expect.arrayContaining(["Tout97", "Objections81", "Suggestions15", "Réclamations1", "À vérifier11"]));
  });

  it("grouped by reason; « À vérifier » keeps the rows with no reason", () => {
    mount();
    expect(screen.getAllByRole("row").some((r) => r.classList.contains("g") && r.textContent?.includes("Pas de cash maintenant"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /À vérifier/ }));
    const bodies = screen.getAllByRole("row").filter((r) => r.classList.contains("r")).map((r) => r.textContent ?? "");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("يقول c");
  });

  it("select rows → Écarter → the toast offers Annuler", async () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner يقول a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner يقول b" }));
    expect(screen.getByText("2 sélectionnés")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Écarter" })); });
    expect(discardFeedback).toHaveBeenCalledWith(["a", "b"]);
    expect(screen.getByText("2 écartés — ils ne comptent plus.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Annuler" })); });
    expect(restoreFeedback).toHaveBeenCalledWith(["a", "b"]);
  });

  it("Changer la raison on the selection", async () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner يقول c" }));
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Changer la raison" }), { target: { value: "t-card" } });
    });
    expect(setFeedbackTopic).toHaveBeenCalledWith(["c"], "t-card");
  });

  it("a row opens the drawer: the words, the facts, the reason, Écarter", async () => {
    mount();
    fireEvent.click(screen.getByText("يقول a"));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Ancienne note « Autre » importée")).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "#10517" }).getAttribute("href")).toBe("/fr/orders?open=o1");
    await act(async () => {
      fireEvent.change(within(drawer).getByRole("combobox"), { target: { value: "" } });
    });
    expect(setFeedbackTopic).toHaveBeenCalledWith(["a"], null);
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Écarter" })); });
    expect(discardFeedback).toHaveBeenCalledWith(["a"]);
  });

  it("a complaint in the drawer: Je m'en occupe, Résolue", async () => {
    mount();
    fireEvent.click(screen.getByText("Incorrect product specs"));
    const drawer = screen.getByRole("dialog");
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Je m'en occupe" })); });
    expect(setComplaintStatus).toHaveBeenCalledWith("k1", "in_progress");
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Résolue" })); });
    expect(setComplaintStatus).toHaveBeenCalledWith("k1", "resolved");
  });
});
