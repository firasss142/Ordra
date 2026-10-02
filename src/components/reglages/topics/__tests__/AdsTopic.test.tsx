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
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: toast }) }));
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.byKey[key] : undefined, isLoading: false, mutate: swr.mutate }) }));

import { ReglagesFormProvider } from "../../form-context";
import { SaveBar } from "../../kit/SaveBar";
import { AdsTopic } from "../AdsTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "A", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };

const fetchMock = vi.fn();
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  // Production, 2026-10-02: Libya has one account and a rate of 8.4.
  swr.byKey = {
    "/api/meta/accounts": {
      data: [
        { id: "acc1", market_id: LY, ad_account_id: "act_555", account_name: "Totella AdAccount 5", account_currency: "USD", is_active: true, last_synced_at: "2026-10-02T13:42:00Z", last_sync_error: null },
        { id: "acc2", market_id: TN, ad_account_id: "act_777", account_name: "Autre marché", account_currency: "USD", is_active: true, last_synced_at: null, last_sync_error: null },
      ],
    },
    [`/api/meta/fx-rate?market_id=${LY}`]: { data: { rates: { USD: 8.4 }, updated_at: "2026-08-15T10:00:00Z" } },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true, stages: [] } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

const mount = () =>
  render(
    <ReglagesFormProvider>
      <SaveBar />
      <AdsTopic user={admin} marketId={LY} marketCode="ly" />
    </ReglagesFormProvider>,
  );
const accounts = () => screen.getByRole("heading", { name: "Comptes publicitaires Meta" }).closest("section") as HTMLElement;

describe("Réglages › Publicité", () => {
  it("lists only this market's accounts", () => {
    mount();
    const rows = within(accounts()).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Totella AdAccount 5");
    expect(rows[0]).toHaveTextContent("USD");
  });

  it("disconnects an account only after asking", async () => {
    mount();
    await userEvent.click(within(accounts()).getByRole("button", { name: "Déconnecter" }));
    const dialog = screen.getByRole("alertdialog");
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Déconnecter" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/meta/accounts/acc1", expect.objectContaining({ method: "DELETE" })));
  });

  it("connects a new account for this market", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: "acc3" } }), { status: 201 }));
    mount();
    await userEvent.click(within(accounts()).getByRole("button", { name: "Connecter un compte" }));
    const panel = screen.getByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Identifiant du compte publicitaire"), "act_999");
    await userEvent.type(within(panel).getByLabelText("Jeton d’accès"), "EAAG-token");
    await userEvent.click(within(panel).getByRole("button", { name: "Connecter" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/meta/accounts", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ market_id: LY, ad_account_id: "act_999", access_token: "EAAG-token" });
  });

  it("says why Meta refused a token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 }));
    mount();
    await userEvent.click(within(accounts()).getByRole("button", { name: "Connecter un compte" }));
    const panel = screen.getByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Identifiant du compte publicitaire"), "act_999");
    await userEvent.type(within(panel).getByLabelText("Jeton d’accès"), "bad");
    await userEvent.click(within(panel).getByRole("button", { name: "Connecter" }));
    expect(await within(panel).findByText("Meta refuse ce jeton.")).toBeInTheDocument();
  });

  it("changes the dollar rate through the save bar", async () => {
    mount();
    const rate = screen.getByRole("spinbutton", { name: "Taux de change du dollar" });
    expect(rate).toHaveValue(8.4);
    expect(screen.getByText(/converties à 8,4 LYD/)).toBeInTheDocument();
    await userEvent.clear(rate);
    await userEvent.type(rate, "8.6");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/meta/fx-rate", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ market_id: LY, currency: "USD", rate: 8.6 });
  });
});
