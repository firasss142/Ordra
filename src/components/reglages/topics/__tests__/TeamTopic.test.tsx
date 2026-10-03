import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import type { AuthUser } from "@/types";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.byKey[key] : undefined, isLoading: false, mutate: swr.mutate }) }));

import { ReglagesFormProvider } from "../../form-context";
import { SaveBar } from "../../kit/SaveBar";
import { TeamTopic } from "../TeamTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "A", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const manager: AuthUser = { ...admin, id: "m", role: "market_manager", market_id: LY };
const rate = (agent_id: string | null, amount: number, enabled: boolean, from: string) => ({ id: `r-${agent_id}`, agent_id, enabled, amount, effective_from: from, effective_to: null, note: null, set_by_name: "Super Admin", created_at: "" });

const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T14:00:00Z"));
  intl.messages = frMessages as Record<string, unknown>;
  // Libya, production 2026-10-02.
  swr.byKey = {
    [`/api/settings/${LY}`]: { data: [{ key: "assignment_algorithm", value: { value: "manual" } }] },
    [`/api/settings/agent-shares?market_id=${LY}`]: {
      data: [
        { agent_id: "s", full_name: "salima", avatar_url: null, share_pct: null },
        { agent_id: "t", full_name: "tasnim", avatar_url: null, share_pct: null },
      ],
    },
    [`/api/settings/commissions?market_id=${LY}`]: {
      data: {
        market_id: LY, currency: "LYD",
        market: rate(null, 9, true, "2026-09-12"),
        agents: [
          { agent_id: "s", name: "salima", avatar_url: null, is_active: true, override: rate("s", 9, true, "2026-09-14") },
          { agent_id: "r", name: "riheb", avatar_url: null, is_active: true, override: rate("r", 10, true, "2026-08-25") },
          { agent_id: "mo", name: "mouna", avatar_url: null, is_active: true, override: rate("mo", 0, false, "2026-08-25") },
          { agent_id: "x", name: "ancienne", avatar_url: null, is_active: false, override: null },
        ],
        history: [],
      },
    },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.useRealTimers());

function mount(user: AuthUser) {
  render(
    <ReglagesFormProvider>
      <SaveBar />
      <TeamTopic user={user} marketId={LY} marketCode="ly" />
    </ReglagesFormProvider>,
  );
}

describe("Réglages › Équipe", () => {
  it("offers the four methods that work — not « par produit » nor « par région »", () => {
    mount(manager);
    const group = screen.getByRole("radiogroup", { name: "Méthode de distribution" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Manuelle"),
      expect.stringContaining("Tour à tour"),
      expect.stringContaining("Selon la charge"),
      expect.stringContaining("Par pourcentages"),
    ]);
    expect(within(group).getByRole("radio", { name: /Manuelle/ })).toHaveAttribute("aria-checked", "true");
  });

  it("switching to percentages asks for the shares and saves them before the method", async () => {
    mount(manager);
    await userEvent.click(screen.getByRole("radio", { name: /Par pourcentages/ }));
    expect(screen.getByText("Il manque 100 %")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("spinbutton", { name: "Part de salima" }), "60");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Part de tasnim" }), "40");
    expect(screen.getByText("Prêt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [first, second] = fetchMock.mock.calls;
    expect(first[0]).toBe("/api/settings/agent-shares");
    expect(first[1].method).toBe("PUT");
    expect(JSON.parse(first[1].body)).toEqual({ market_id: LY, shares: { s: 60, t: 40 } });
    expect(second[0]).toBe(`/api/settings/${LY}`);
    expect(JSON.parse(second[1].body)).toEqual({ assignment_algorithm: "percentage" });
  });

  it("refuses shares that do not make 100 % and sends nothing", async () => {
    mount(manager);
    await userEvent.click(screen.getByRole("radio", { name: /Par pourcentages/ }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Part de salima" }), "50");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("La répartition doit faire exactement 100 %.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides the commissions from a manager", () => {
    mount(manager);
    expect(screen.queryByRole("heading", { name: "Commissions" })).not.toBeInTheDocument();
  });

  it("shows each active agent's commission, and which ones have their own amount", () => {
    mount(admin);
    const comm = screen.getByRole("heading", { name: "Commissions" }).closest("section") as HTMLElement;
    const rows = within(comm).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("riheb");
    expect(rows[1]).toHaveTextContent("montant propre");
    expect(rows[2]).toHaveTextContent("Non payé");
    expect(within(comm).getByText(/En vigueur depuis le 12 sept\. 2026/)).toBeInTheDocument();
  });

  it("a new team amount applies from today, through the save bar", async () => {
    mount(admin);
    const amount = screen.getByRole("spinbutton", { name: "Montant par commande livrée" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "10");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings/commissions");
    expect(JSON.parse(init.body)).toEqual({ market_id: LY, agent_id: null, amount: 10, enabled: true, effective_from: "2026-10-02" });
  });

  describe("Salle de contrôle — the administrator's thresholds (prototypes/team-v5.html)", () => {
    const ROQAYA = "11111111-1111-4111-8111-111111111111";
    beforeEach(() => {
      swr.byKey[`/api/agents?market_id=${LY}`] = { data: [{ id: ROQAYA, full_name: "roqaya", role: "agent" }] };
    });

    it("a manager reads them and cannot change them", () => {
      mount(manager);
      const card = screen.getByRole("heading", { name: "Salle de contrôle" }).closest("section") as HTMLElement;
      expect(within(card).getByText("Réglé par l'administrateur")).toBeInTheDocument();
      expect(within(card).queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(within(card).getAllByRole("button", { pressed: true }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    });

    it("an administrator moves the call delay and gives one agent her own hours, through the save bar", async () => {
      mount(admin);
      const card = screen.getByRole("heading", { name: "Salle de contrôle" }).closest("section") as HTMLElement;
      const delay = within(card).getByRole("spinbutton", { name: "Commande «\u00a0non appelée\u00a0» après" });
      expect(delay).toHaveValue(2);
      await userEvent.clear(delay);
      await userEvent.type(delay, "3");
      await userEvent.selectOptions(within(card).getByRole("combobox", { name: "Choisir un agent" }), ROQAYA);
      await userEvent.click(within(card).getByRole("button", { name: "Ajouter" }));
      await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`/api/settings/${LY}`);
      expect(JSON.parse(init.body)).toEqual({
        team_call_delay_hours: 3,
        team_shift_overrides: { [ROQAYA]: { start: "08:00", end: "18:00" } },
      });
    });
  });
});
