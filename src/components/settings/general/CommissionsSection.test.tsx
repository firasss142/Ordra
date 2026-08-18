import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { CommissionsSection } from "./CommissionsSection";

const messages = { settings: { commissions: {
  tab: "Commissions", title: "Commissions", description: "desc",
  enabledLabel: "Commissions activées", enabledHint: "hint", enabledFor: "Activées pour {market}", disabledFor: "Désactivées pour {market}",
  rateLabel: "Commission par commande livrée ({currency})", rateHint: "hint", fromLabel: "À partir du", fromHint: "hint", fromToday: "aujourd'hui",
  perAgentLabel: "Par agent", perAgentHint: "hint", colAgent: "Agent", colCommission: "Commission", colRate: "Taux", colSince: "Depuis", colNote: "Note",
  marketRate: "marché", ownRate: "taux propre", off: "désactivée", inactive: "inactif", setOwnRate: "Taux propre…", edit: "Modifier", clearOverride: "Revenir au taux du marché",
  perAgentNote: "note", historyLabel: "Historique", historyHint: "hint", historyMarket: "marché", historyEnabled: "activé à {amount}", historyDisabled: "désactivé", historyRate: "{amount}", historyEmpty: "Aucun changement.",
  noRate: "Aucun taux", visibleTo: "super_admin", save: "Enregistrer", saving: "…", saved: "Enregistré", failed: "Erreur",
  overrideTitle: "Taux propre — {name}", overrideAmount: "Taux ({currency})", overrideFrom: "À partir du", overrideNote: "Note", apply: "Appliquer", cancel: "Annuler",
  loading: "Chargement…", loadError: "Erreur de chargement",
} } };

const LY = "00000000-0000-0000-0000-000000000002";
const payload = {
  market_id: LY, currency: "LYD",
  market: { id: "m1", agent_id: null, enabled: true, amount: 3, effective_from: "2026-07-27", effective_to: null, note: null, set_by_name: "Firas", created_at: "2026-07-27T00:00:00Z" },
  agents: [
    { agent_id: "t", name: "tasnim", avatar_url: null, is_active: true, override: { id: "o1", agent_id: "t", enabled: true, amount: 3.5, effective_from: "2026-08-01", effective_to: null, note: "senior", set_by_name: "Firas", created_at: "2026-08-01T00:00:00Z" } },
    { agent_id: "s", name: "salima", avatar_url: null, is_active: true, override: null },
    { agent_id: "m", name: "mouna", avatar_url: null, is_active: true, override: { id: "o2", agent_id: "m", enabled: false, amount: 0, effective_from: "2026-08-18", effective_to: null, note: null, set_by_name: "Firas", created_at: "2026-08-18T00:00:00Z" } },
  ],
  history: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/settings/commissions") && (!init || !init.method || init.method === "GET")) {
      return new Response(JSON.stringify({ data: payload }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: "new" } }), { status: 201 });
  });
});

function mount() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CommissionsSection marketId={LY} marketName="Libye" tz="Africa/Tripoli" locale="fr" />
    </NextIntlClientProvider>,
  );
}

describe("CommissionsSection", () => {
  it("renders the market switch, the rate, and one switch per agent with its state", async () => {
    mount();
    await screen.findByText("tasnim");
    const switches = screen.getAllByRole("switch");
    // 1 market + 3 agents
    expect(switches.length).toBe(4);
    expect(screen.getByLabelText(/Commission mouna/).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText(/Commission tasnim/).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("taux propre")).toBeTruthy();
    expect(screen.getByText("désactivée")).toBeTruthy();
    expect((screen.getByLabelText(/Commission par commande livrée/) as HTMLInputElement).value).toBe("3");
  });

  it("saving the market group posts amount + enabled + effective_from with agent_id null", async () => {
    mount();
    await screen.findByText("tasnim");
    fireEvent.change(screen.getByLabelText(/Commission par commande livrée/), { target: { value: "4" } });
    fireEvent.click(screen.getByText("Enregistrer"));
    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body).toMatchObject({ market_id: LY, agent_id: null, amount: 4, enabled: true });
      expect(body.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("flipping an agent switch posts a per-agent row with enabled=false", async () => {
    mount();
    await screen.findByText("tasnim");
    fireEvent.click(screen.getByLabelText(/Commission salima/));
    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body).toMatchObject({ market_id: LY, agent_id: "s", enabled: false });
    });
  });
});
