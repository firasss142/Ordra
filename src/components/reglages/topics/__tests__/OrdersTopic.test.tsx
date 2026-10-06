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
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.byKey[key] : undefined, isLoading: false, mutate: swr.mutate }) }));

import { ReglagesFormProvider } from "../../form-context";
import { SaveBar } from "../../kit/SaveBar";
import { OrdersTopic } from "../OrdersTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const manager: AuthUser = { id: "m", email: "m@x", full_name: "M", avatar_url: null, role: "market_manager", market_id: LY, locale: "fr", direction: "ltr" };

function mount() {
  render(
    <ReglagesFormProvider>
      <SaveBar />
      <OrdersTopic user={manager} marketId={LY} marketCode="ly" />
    </ReglagesFormProvider>,
  );
}

const fetchMock = vi.fn();
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  // Libya, 2026-10-02: 8 attempts, three retry hours, merge window 24 h.
  swr.byKey = {
    [`/api/settings/${LY}`]: {
      data: [
        { key: "max_call_attempts", value: { value: 8 } },
        { key: "attempt_retry_times", value: { value: ["11:00", "14:00", "18:00"] } },
        { key: "merge_window_hours", value: { value: 24 } },
        { key: "duplicate_autoselect_window_hours", value: { value: 0 } },
      ],
    },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("Réglages › Commandes", () => {
  it("shows the three cards and only the settings that do something", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Appels de confirmation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doublons et fusion" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archivage" })).toBeInTheDocument();
    for (const hidden of ["Affectation à l'arrivée", "Montant de commande", "Heure limite d'expédition", "Téléversement automatique", "Ville non reconnue", "Après la dernière tentative"]) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
  });

  it("reads the stored value into the help, and the help follows what you type", async () => {
    mount();
    const attempts = screen.getByRole("spinbutton", { name: "Nombre maximum d’appels" });
    expect(attempts).toHaveValue(8);
    expect(screen.getByText("Au 8ᵉ appel sans réponse, la commande est rejetée automatiquement avec le motif « Injoignable »." )).toBeInTheDocument();
    await userEvent.clear(attempts);
    await userEvent.type(attempts, "6");
    expect(screen.getByText(/Au 6ᵉ appel sans réponse/)).toBeInTheDocument();
    expect(screen.getByText("1 modification non enregistrée")).toBeInTheDocument();
  });

  it("says a zero window switches the feature off", () => {
    mount();
    expect(screen.getByText("Rien n’est coché d’avance : vous choisissez chaque doublon.")).toBeInTheDocument();
  });

  it("saves only what changed", async () => {
    mount();
    const merge = screen.getByRole("spinbutton", { name: "Fusion de commandes" });
    await userEvent.clear(merge);
    await userEvent.type(merge, "12");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/settings/${LY}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ merge_window_hours: 12 });
  });

  it("removes a retry hour and saves the remaining ones in order", async () => {
    mount();
    const row = screen.getByText("Heures de rappel").closest("[data-testid='setting-row']") as HTMLElement;
    expect(within(row).getAllByRole("textbox")).toHaveLength(3);
    await userEvent.click(within(row).getAllByRole("button", { name: "Retirer" })[1]);
    expect(within(row).getAllByRole("textbox")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ attempt_retry_times: ["11:00", "18:00"] });
  });

  it("refuses to send a value out of bounds and says so", async () => {
    mount();
    const attempts = screen.getByRole("spinbutton", { name: "Nombre maximum d’appels" });
    await userEvent.clear(attempts);
    await userEvent.type(attempts, "50");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText(/hors des limites autorisées/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Réglages › Commandes › Paiement par carte", () => {
  const admin: AuthUser = { ...manager, id: "a", role: "super_admin", market_id: null };

  it("shows a manager the card surcharge as a value, never an input: it is money", () => {
    mount();
    const row = screen.getByText("Majoration paiement par carte").closest("[data-testid='setting-row']") as HTMLElement;
    expect(within(row).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(row).getByText("10")).toBeInTheDocument();
  });

  it("lets the administrator change it, and the help restates the rate", async () => {
    render(
      <ReglagesFormProvider>
        <SaveBar />
        <OrdersTopic user={admin} marketId={LY} marketCode="ly" />
      </ReglagesFormProvider>,
    );
    const input = screen.getByRole("spinbutton", { name: "Majoration paiement par carte" });
    expect(input).toHaveValue(10);
    await userEvent.clear(input);
    await userEvent.type(input, "8");
    expect(screen.getByText(/paie 8 % de plus sur les produits/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ card_surcharge_pct: 8 });
  });
});
