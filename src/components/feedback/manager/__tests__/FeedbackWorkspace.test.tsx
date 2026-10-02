import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { FeedbackOverviewResponse, FeedbackSheetRow } from "@/types/feedback";

// ── router / URL ─────────────────────────────────────────────────────────────
let search = new URLSearchParams();
const replace = vi.fn((url: string) => { search = new URLSearchParams(url.split("?")[1] ?? ""); });
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => "/fr/feedback",
}));

// ── data ─────────────────────────────────────────────────────────────────────
const OVERVIEW: FeedbackOverviewResponse = {
  today: "2026-09-30", first: "2026-05-21", from: "2026-09-01", to: "2026-09-30", preset: "d30", hasPrev: true,
  families: [
    { id: "bag", label: "دميه ملاكمه", imageUrl: "https://img/bag.jpeg", productIds: ["bs", "bm"] },
    { id: "q", label: "القرآن تدبر وعمل", imageUrl: "https://img/q.jpeg", productIds: ["q"] },
  ],
  topics: [
    { id: "t-nocash", category: "objection", key: "nocash", label_fr: "Pas de cash maintenant", label_ar: "x", sort_order: 1 },
    { id: "t-nonconform", category: "reclamation", key: "nonconform", label_fr: "Non conforme à la commande", label_ar: "x", sort_order: 0 },
  ],
  agents: [{ id: "tasnim", name: "tasnim" }, { id: "hend", name: "hend" }, { id: "salima", name: "salima" }],
  tabs: { all: 60, byFamily: [{ id: "q", count: 40 }, { id: "bag", count: 20 }] },
  kpis: [
    { category: "reclamation", count: 4, prev: 1, series: [0, 1, 0, 3] },
    { category: "objection", count: 50, prev: 18, series: [10, 20, 10, 10] },
    { category: "suggestion", count: 6, prev: 6, series: [1, 2, 1, 2] },
  ],
  total: 60,
  mix: [{ category: "reclamation", count: 4 }, { category: "objection", count: 50 }, { category: "suggestion", count: 6 }],
  ranked: [
    { category: "objection", topicId: "t-nocash", count: 23, prev: 9, share: 38 },
    { category: "reclamation", topicId: "t-nonconform", count: 3, prev: 0, share: 5 },
  ],
  byAgent: [
    { id: "tasnim", name: "tasnim", count: 48, byCategory: { reclamation: 1, objection: 44, suggestion: 3 } },
    { id: "hend", name: "hend", count: 3, byCategory: { reclamation: 0, objection: 3, suggestion: 0 } },
    { id: "salima", name: "salima", count: 0, byCategory: { reclamation: 0, objection: 0, suggestion: 0 } },
  ],
  agentsTotal: 51,
  complaints: { open: 2, late: 1 },
  review: 42,
};
const ROW = (id: string, over: Partial<FeedbackSheetRow> = {}): FeedbackSheetRow => ({
  id, created_at: "2026-09-28T09:00:00Z", category: "objection", topic_id: "t-nocash", body: "قالت لا املك المبلغ",
  moment: "call", source: "import", status: null, needs_review: false,
  product: { id: "q", name: "القرآن تدبر وعمل", image_url: null }, customer_name: "فاطمة", customer_phone: "0926110387",
  order_id: "o1", order_ref: "39508", author: { id: "tasnim", name: "tasnim" }, assignee: null, ...over,
});
const COMPLAINT = ROW("c1", {
  category: "reclamation", topic_id: "t-nonconform", body: "مش نفس لي في نت", status: "open", created_at: "2026-09-25T09:00:00Z",
  source: "courier", author: null,
});

let rowsQuery: Record<string, unknown> = {};
let overviewQuery: Record<string, unknown> = {};
const reviewFeedback = vi.fn();
const setComplaintStatus = vi.fn();
vi.mock("@/hooks/useFeedback", () => ({
  useFeedbackOverview: (q: Record<string, unknown>) => { overviewQuery = q; return { overview: OVERVIEW, error: null, mutate: vi.fn() }; },
  useFeedbackRows: (q: Record<string, unknown>) => {
    rowsQuery = q;
    const rows = q.mode === "review" ? [ROW("r1", { needs_review: true, source: "courier", author: null })] : [ROW("a"), COMPLAINT];
    return { rows, total: q.mode === "review" ? 1 : 25, error: null, mutate: vi.fn() };
  },
  useFeedbackDays: () => new Set(["2026-09-12"]),
  reviewFeedback: (...a: unknown[]) => reviewFeedback(...a),
  setComplaintStatus: (...a: unknown[]) => setComplaintStatus(...a),
}));
vi.mock("@/context/market-scope", () => ({ useMarketScope: () => ({ marketId: null }) }));

import { FeedbackWorkspace } from "../FeedbackWorkspace";

function mount() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <FeedbackWorkspace role="market_manager" marketId="00000000-0000-0000-0000-000000000002" locale="fr" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  search = new URLSearchParams();
  replace.mockClear();
  reviewFeedback.mockReset().mockResolvedValue({ count: 1 });
  setComplaintStatus.mockReset().mockResolvedValue({ id: "c1" });
});

describe("FeedbackWorkspace — the numbers on top", () => {
  it("product pills: all, then families by volume, each with its photo", () => {
    mount();
    const tabs = within(screen.getByRole("tablist", { name: "Produits" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Tous les produits60", "القرآن تدبر وعمل40", "دميه ملاكمه20"]);
    expect(tabs[1].querySelector("img")?.getAttribute("src")).toBe("https://img/q.jpeg");
    fireEvent.click(tabs[2]);
    expect(search.get("prod")).toBe("bag");
  });

  it("the to-do strip: late complaints and what waits for validation", () => {
    mount();
    expect(screen.getByRole("button", { name: /1 réclamation sans réponse depuis plus de 48 h/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /42 retours à valider/ })).toBeInTheDocument();
  });

  it("three category cards with the count and the change against the previous period", () => {
    mount();
    const card = screen.getByRole("button", { name: /Objections/ });
    expect(card).toHaveTextContent("50");
    expect(card).toHaveTextContent("↑ 32");
    expect(card).toHaveTextContent("83 % des retours");
    expect(screen.getByRole("button", { name: /Réclamations/ })).toHaveTextContent("2 ouvertes · 1 > 48 h");
    // No change still shows its number, like the prototype: « = 0 ».
    expect(screen.getByRole("button", { name: /Suggestions/ })).toHaveTextContent("= 0 vs période précédente");
    fireEvent.click(card);
    expect(search.get("cat")).toBe("objection");
  });

  it("top topics: ranked, shared, with the change — « nouveau » when it was absent", () => {
    mount();
    const rows = screen.getAllByTestId("topic-row");
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent("Pas de cash maintenant");
    expect(rows[0]).toHaveTextContent("38 %");
    expect(rows[0]).toHaveTextContent("↑14");
    expect(rows[1]).toHaveTextContent("nouveau");
    fireEvent.click(rows[0]);
    expect(search.get("cat")).toBe("objection");
    expect(search.get("topic")).toBe("t-nocash");
  });

  it("entries per agent, flagging an agent with none and one far below the leader", () => {
    mount();
    const rows = screen.getAllByTestId("agent-row");
    expect(rows.map((r) => r.getAttribute("data-agent"))).toEqual(["tasnim", "hend", "salima"]);
    expect(rows[1]).toHaveTextContent("faible");
    expect(rows[2]).toHaveTextContent("aucune saisie");
    fireEvent.click(rows[1]);
    expect(search.get("agent")).toBe("hend");
  });
});

describe("FeedbackWorkspace — the period", () => {
  it("quick buttons set a preset; the comparison follows", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "7 j" }));
    expect(search.get("from")).toBe("2026-09-24");
    expect(search.get("to")).toBe("2026-09-30");
  });

  it("a quick preset always shows its range on the date button, even a single day", () => {
    search = new URLSearchParams("from=2026-09-30&to=2026-09-30");
    mount();
    expect(screen.getByRole("button", { name: "Aujourd'hui" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^30 sept\. – 30 sept\.$/ })).toBeInTheDocument();
  });

  it("a custom range from the calendar: start, end, apply", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /1 sept\. – 30 sept\./ }));
    fireEvent.click(screen.getByRole("button", { name: "10 septembre 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "20 septembre 2026" }));
    expect(screen.getByText(/11 jours/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    expect(search.get("from")).toBe("2026-09-10");
    expect(search.get("to")).toBe("2026-09-20");
  });
});

describe("FeedbackWorkspace — the sheet", () => {
  it("lists the rows with the prototype's columns, and grows by 20", () => {
    mount();
    for (const col of ["Date", "Catégorie", "Sujet", "Le client dit", "Produit", "Agent", "Statut"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeInTheDocument();
    }
    const complaint = screen.getByRole("row", { name: /مش نفس لي في نت/ });
    expect(complaint).toHaveTextContent("livreur Darb");
    // The sheet's tag is the prototype's flat .tag — no dot, unlike the agent's capture tag.
    const tag = complaint.querySelector("[data-category]");
    expect(tag).toHaveTextContent("Réclamation");
    expect(tag?.querySelector("[aria-hidden]")).toBeNull();
    expect(complaint).toHaveTextContent("Ouverte");
    fireEvent.click(screen.getByRole("button", { name: "Voir 20 de plus" }));
    expect(rowsQuery.limit).toBe(40);
  });

  it("the drawer follows a complaint: take it, resolve it", async () => {
    mount();
    fireEvent.click(screen.getByRole("row", { name: /مش نفس لي في نت/ }));
    const drawer = screen.getByRole("dialog");
    expect(drawer).toHaveTextContent("Commande");
    expect(within(drawer).getByRole("link", { name: /#39508/ }).getAttribute("href")).toBe("/fr/orders?open=o1");
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Prendre en charge" })); });
    expect(setComplaintStatus).toHaveBeenCalledWith("c1", "in_progress");
    await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: /Marquer résolue/ })); });
    expect(setComplaintStatus).toHaveBeenCalledWith("c1", "resolved");
  });

  it("« À valider »: Garder / Ignorer per row", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /42 retours à valider/ }));
    expect(search.get("review")).toBe("1");
    expect(rowsQuery.mode).toBe("review");
    expect(screen.getByRole("heading", { name: /À valider/ })).toBeInTheDocument();
    // The numbers make room for the queue.
    expect(screen.queryByTestId("topic-row")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Garder" })); });
    expect(reviewFeedback).toHaveBeenCalledWith("keep", ["r1"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ignorer" })); });
    expect(reviewFeedback).toHaveBeenCalledWith("ignore", ["r1"]);
  });
});
