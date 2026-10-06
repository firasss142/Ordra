import { describe, it, expect, vi, beforeEach } from "vitest";
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
const swr = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as unknown, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: () => ({ data: swr.data, error: swr.error, isLoading: false, mutate: swr.mutate }) }));

import { ReglagesFormProvider } from "../../form-context";
import { SaveBar } from "../../kit/SaveBar";
import { MonitoringTopic } from "../MonitoringTopic";

const admin: AuthUser = { id: "a", email: "a@x", full_name: "A", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const fetchMock = vi.fn();

const ROWS = [
  { rule_key: "connection_silent", enabled: true, params: { minutes: 30 } },
  { rule_key: "server_error", enabled: true, params: { count: 3, hours: 24 } },
  { rule_key: "large_export", enabled: true, params: { rows: 1000 } },
  { rule_key: "whatsapp_down", enabled: true, params: {} },
];

function mount() {
  render(
    <ReglagesFormProvider>
      <SaveBar />
      <MonitoringTopic user={admin} marketId="" marketCode={null} />
    </ReglagesFormProvider>,
  );
}

beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  swr.data = { data: ROWS };
  swr.error = undefined;
  swr.mutate.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("Réglages › Surveillance", () => {
  it("groups the rules by what they watch, each with a sentence that says when a problem opens", () => {
    mount();
    for (const h of ["Transporteurs et services", "Boutiques et publicité", "Tâches automatiques", "Ordra lui-même", "Sécurité"]) {
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText("Un problème s’ouvre quand un compte Darb actif ne s’est pas synchronisé depuis 30 min.")).toBeInTheDocument();
    expect(screen.getByText("Un problème s’ouvre quand la même erreur revient 3 fois en 24 h.")).toBeInTheDocument();
  });

  it("a rule with no row yet shows its default, so the page is complete from day one", () => {
    mount();
    expect(screen.getByRole("spinbutton", { name: "Page qui plante — fois" })).toHaveValue(3);
  });

  it("changing a threshold and switching a rule off saves both, one request per rule", async () => {
    mount();
    const count = screen.getByRole("spinbutton", { name: "Erreur du serveur Ordra — fois" });
    await userEvent.clear(count);
    await userEvent.type(count, "5");
    expect(screen.getByText("Un problème s’ouvre quand la même erreur revient 5 fois en 24 h.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Gros export" }));
    expect(screen.getByText("2 modifications non enregistrées")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map((c) => [c[0], c[1].method, JSON.parse(c[1].body)]);
    expect(bodies).toContainEqual(["/api/admin/journal/rules", "PATCH", { rule_key: "server_error", enabled: true, params: { count: 5, hours: 24 } }]);
    expect(bodies).toContainEqual(["/api/admin/journal/rules", "PATCH", { rule_key: "large_export", enabled: false, params: { rows: 1000 } }]);
  });

  it("a rule switched off says so in plain words", async () => {
    mount();
    await userEvent.click(screen.getByRole("switch", { name: "Gros export" }));
    const row = screen.getByText("Gros export").closest("[data-testid='setting-row']") as HTMLElement;
    expect(within(row).getByText("Éteinte : Ordra ne surveille plus cela, et le problème ouvert se ferme.")).toBeInTheDocument();
  });

  it("refuses a value out of range before sending anything", async () => {
    mount();
    const count = screen.getByRole("spinbutton", { name: "Erreur du serveur Ordra — fois" });
    await userEvent.clear(count);
    await userEvent.type(count, "0");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText(/Erreur du serveur Ordra : entre 1 et 100/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("before the SQL is pasted, it says the thresholds are not available yet instead of failing", () => {
    swr.data = undefined;
    swr.error = new Error("500");
    mount();
    expect(screen.getByText(/pas encore disponibles/)).toBeInTheDocument();
  });
});
