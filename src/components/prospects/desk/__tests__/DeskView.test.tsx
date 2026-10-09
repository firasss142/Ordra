import { describe, test, expect, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { buildDesk } from "@/lib/prospects/desk/model";
import type { DeskFacts } from "@/lib/prospects/desk/types";
import { DeskView, type DeskViewProps } from "../DeskView";

vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));

const LY = "00000000-0000-0000-0000-000000000002";
const SETTINGS = { enabled: true, rej: { on: true, delay_days: 3, subreasons: ["pas_de_reponse"] }, ret: { on: true }, old: { on: true, after_days: 30 }, dist: { hour: 9, file_cap: 15, release_days: 3, max_tries: 3 } };
const FACTS: DeskFacts = {
  generated_at: "2026-10-06T10:00:00Z", month: { from: "2026-10-01", to: "2026-10-31" }, settings: SETTINGS, last_tick_at: "2026-10-06T07:00:00Z",
  hero: { delivered: 16, revenue: 3984, converted: 21, on_road: 0, not_shipped: 5, returned: 0, prev_delivered: 9 },
  sources: [
    { key: "rej", created: 40, to_call: 9, in_progress: 19, won: 5, lost: 7, delivered: 5, revenue: 1245 },
    { key: "ret", created: 16, to_call: 4, in_progress: 8, won: 2, lost: 2, delivered: 2, revenue: 498 },
    { key: "old", created: 30, to_call: 7, in_progress: 13, won: 4, lost: 6, delivered: 4, revenue: 996 },
    { key: "camp", created: 56, to_call: 18, in_progress: 22, won: 10, lost: 6, delivered: 5, revenue: 1245 },
  ],
  agents: [
    { id: "a1", name: "tasnim", color: "indigo", last_seen_at: "2026-10-06T09:58:00Z", in_rotation: true, file_open: 12, called_today: 8, late_callbacks: 0, stale: 0, converted_month: 4, delivered_month: 3, revenue_month: 747 },
    { id: "a2", name: "riheb", color: "orange", last_seen_at: null, in_rotation: true, file_open: 15, called_today: 0, late_callbacks: 0, stale: 6, converted_month: 3, delivered_month: 3, revenue_month: 747 },
  ],
  pool: { open: 19, oldest_days: 5 }, open_total: 100,
};
const PRODUCTS = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: i === 7 ? "Coran Tadabbur" : `Livre ${i}`, price: 249, image: null }));

function setup(over: Partial<DeskViewProps> = {}) {
  const props: DeskViewProps = {
    view: buildDesk(FACTS, new Date("2026-10-06T10:00:00Z")), settings: SETTINGS, month: "2026-10", currentMonth: "2026-10", onMonth: vi.fn(),
    rows: [], total: 0, listLoading: false, error: false, onRetry: vi.fn(),
    filters: { sources: [], agents: [], state: "open", q: "", page: 1 }, onFilters: vi.fn(),
    products: PRODUCTS, cities: ["طرابلس"], subreasons: [{ key: "pas_de_reponse", label: "Pas de réponse" }], reasonLabel: (k) => k,
    waActive: false, waLang: "ar", locale: "fr", tz: "Africa/Tripoli", marketId: LY, toast: null,
    onDistribute: vi.fn().mockResolvedValue(undefined), onAssign: vi.fn(), onCloseLeads: vi.fn(), onSaveRules: vi.fn(), onExport: vi.fn(),
    onPreview: vi.fn().mockResolvedValue({ net: 12, excluded: 2 }), onCreateList: vi.fn().mockResolvedValue("x"),
    ...over,
  };
  render(<NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli"><DeskView {...props} /></NextIntlClientProvider>);
  return props;
}

describe("the Prospects desk", () => {
  test("the band answers with what came back AND was delivered, and folds the to-do into one button", async () => {
    const p = setup();
    expect(screen.getByText("Ramené en octobre")).toBeInTheDocument();
    expect(screen.getByText(/commandes livrées/)).toBeInTheDocument();
    const todo = screen.getByRole("button", { name: /À faire/ });
    expect(todo).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Répartir maintenant" })).toBeNull();
    await userEvent.click(todo);
    await userEvent.click(screen.getByRole("button", { name: "Répartir maintenant" }));
    expect(p.onDistribute).toHaveBeenCalled();
  });

  test("when nothing needs the manager, one calm line instead of the to-do", () => {
    setup({ view: buildDesk({ ...FACTS, pool: { open: 0, oldest_days: null }, agents: [{ ...FACTS.agents[0] }] }, new Date("2026-10-06T10:00:00Z")) });
    expect(screen.getByText("Tout tourne")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /À faire/ })).toBeNull();
  });

  test("a source card adds its source to the filter; a second card adds to it", async () => {
    const p = setup({ filters: { sources: ["rej"], agents: [], state: "open", q: "", page: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Colis en retour/ }));
    expect(p.onFilters).toHaveBeenCalledWith({ sources: ["rej", "ret"], page: 1 });
  });

  test("the Agent filter is a multi-select: picking two keeps both", async () => {
    const p = setup({ filters: { sources: [], agents: ["a1"], state: "open", q: "", page: 1 } });
    await userEvent.click(screen.getByRole("button", { name: /Agent :/ }));
    const list = screen.getByRole("listbox", { name: "Agent" });
    await userEvent.click(within(list).getByRole("option", { name: /riheb/ }));
    expect(p.onFilters).toHaveBeenCalledWith({ agents: ["a1", "a2"], page: 1 });
  });

  test("« Nouvelle liste »: the count gates « Continuer », and the products are a searchable list, not 50 tiles", async () => {
    const zero = vi.fn().mockResolvedValue({ net: 0, excluded: 0 });
    setup({ onPreview: zero });
    await userEvent.click(screen.getByRole("button", { name: "Nouvelle liste" }));
    await waitFor(() => expect(zero).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Continuer" })).toBeDisabled();

    // The picker shows nothing until opened, then filters as you type.
    expect(screen.queryByRole("option", { name: /Livre 3/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Choisir des produits/ }));
    expect(screen.getAllByRole("option")).toHaveLength(50);
    fireEvent.change(screen.getByRole("textbox", { name: "Chercher un produit" }), { target: { value: "Tadab" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.click(screen.getByRole("option", { name: /Coran Tadabbur/ }));
    expect(screen.getByRole("button", { name: /1 produit sélectionné/ })).toBeInTheDocument();
  });

  test("with people in the list, « Continuer » leads to the offer, where products can be several", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Nouvelle liste" }));
    const next = screen.getByRole("button", { name: "Continuer" });
    await waitFor(() => expect(next).toBeEnabled());
    await userEvent.click(next);
    expect(screen.getByText("Produits à proposer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Choisir des produits/ }));
    const options = screen.getAllByRole("option");
    await userEvent.click(options[1]);
    await userEvent.click(options[2]);
    expect(screen.getByRole("button", { name: /2 produits sélectionnés/ })).toBeInTheDocument();
  });
});
