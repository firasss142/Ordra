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

import { MarketsTopic } from "../MarketsTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "Admin", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };

const fetchMock = vi.fn();
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  // Production, 2026-10-02: both markets active; label sender name only.
  swr.byKey = {
    "/api/markets?detail=1": {
      data: [
        { id: LY, code: "ly", name: "Libya", language: "ar", currency: "LYD", direction: "rtl", is_active: true, sender_name: "Libya", sender_address: null, sender_phone: null },
        { id: TN, code: "tn", name: "Tunisia", language: "fr", currency: "TND", direction: "ltr", is_active: true, sender_name: "Tunisia", sender_address: null, sender_phone: null },
      ],
    },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("Réglages › Marchés", () => {
  it("lists each market quietly: name, team language, currency, state — nothing to monitor", () => {
    render(<MarketsTopic user={admin} marketId="" marketCode={null} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Libye");
    expect(rows[0]).toHaveTextContent("Arabe");
    expect(rows[0]).toHaveTextContent("LYD");
    expect(rows[0]).toHaveTextContent("Actif");
    expect(screen.queryByText(/À vérifier/)).not.toBeInTheDocument();
    expect(screen.getByText(/Ajouter un marché demande une intervention technique/)).toBeInTheDocument();
  });

  it("opens a market and saves the label sender it never had", async () => {
    render(<MarketsTopic user={admin} marketId="" marketCode={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir Libye" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByLabelText("Devise")).toHaveAttribute("readonly");
    await userEvent.type(within(panel).getByLabelText("Adresse"), "Rue 1, Tripoli");
    await userEvent.type(within(panel).getByLabelText("Téléphone"), "+218 91 000 0000");
    await userEvent.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/markets/${LY}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ sender_address: "Rue 1, Tripoli", sender_phone: "+218 91 000 0000" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(swr.mutate).toHaveBeenCalled();
  });

  it("changes the team language", async () => {
    render(<MarketsTopic user={admin} marketId="" marketCode={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir Tunisie" }));
    const panel = screen.getByRole("dialog");
    await userEvent.click(within(panel).getByRole("radio", { name: /العربية/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ language: "ar" });
  });

  it("refuses an empty market name without calling the server", async () => {
    render(<MarketsTopic user={admin} marketId="" marketCode={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir Libye" }));
    const panel = screen.getByRole("dialog");
    await userEvent.clear(within(panel).getByLabelText("Nom", { selector: "#rg-market-name" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    expect(within(panel).getByText("Le nom du marché ne peut pas être vide.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
