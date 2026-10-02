import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
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

import { RejectionsTopic } from "../RejectionsTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const manager: AuthUser = { id: "m", email: "m@x", full_name: "M", avatar_url: null, role: "market_manager", market_id: LY, locale: "fr", direction: "ltr" };

const row = (id: string, parent: string | null, key: string, fr: string, ar: string, sfr: string, sar: string, sort: number, extra: Record<string, unknown> = {}) => ({
  id, market_id: LY, parent_key: parent, key, label_fr: fr, label_ar: ar, short_fr: sfr, short_ar: sar, sort_order: sort, is_active: true, requires_note: key === "autre", created_at: "", updated_at: "", ...extra,
});

// Libya, production 2026-10-02 (a subset).
const ROWS = [
  row("g1", null, "refus_client", "Refus client", "رفض العميل", "Refus", "رفض", 0),
  row("g2", null, "commande_invalide", "Commande non réelle", "الطلب غير حقيقي", "Non réelle", "غير حقيقي", 1),
  row("g3", null, "injoignable", "Injoignable", "تعذر الاتصال", "Injoignable", "تعذر", 2),
  row("g4", null, "livraison_impossible", "Livraison impossible", "تعذر التوصيل", "Non livrable", "غير قابل", 3),
  row("g5", null, "autre", "Autre", "أخرى", "Autre", "أخرى", 4),
  row("r1", "refus_client", "prix_eleve", "Prix trop élevé", "السعر مرتفع", "Prix", "السعر", 0),
  row("r2", "commande_invalide", "non_serieux", "Commande non sérieuse", "طلب غير جاد", "Non sérieux", "غير جاد", 0),
  row("r3", "injoignable", "pas_de_reponse", "Ne répond pas", "لا يرد", "Sans réponse", "لا يرد", 0),
  row("r4", "injoignable", "raccroche", "Raccroche au téléphone", "يغلق الخط", "Raccroche", "يغلق الخط", 1),
  row("r5", "livraison_impossible", "adresse_invalide", "Adresse invalide", "عنوان غير صحيح", "Adresse", "العنوان", 0),
];

const fetchMock = vi.fn();
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  swr.byKey = {
    [`/api/settings/rejection-reasons?market_id=${LY}`]: { data: ROWS },
    [`/api/settings/rejection-reasons/usage?market_id=${LY}`]: { data: { prix_eleve: 127, non_serieux: 388, pas_de_reponse: 331, raccroche: 17, adresse_invalide: 0 } },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

const mount = () => render(<RejectionsTopic user={manager} marketId={LY} marketCode="ly" />);
const card = (name: string) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("Réglages › Motifs de rejet", () => {
  it("shows the five fixed groups, each with its reasons, their badge and how many orders carry them", () => {
    mount();
    const injoignable = card("Injoignable");
    expect(within(injoignable).getByText("348 commandes", { exact: false })).toBeInTheDocument();
    const rows = within(injoignable).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Ne répond pas"),
      expect.stringContaining("Raccroche au téléphone"),
    ]);
    expect(rows[0]).toHaveTextContent("لا يرد");
    expect(rows[0]).toHaveTextContent("Sans réponse");
    expect(rows[0]).toHaveTextContent("331");
  });

  it("« Autre » has no precise reason and offers none to add", () => {
    mount();
    const autre = card("Autre");
    expect(within(autre).getByText("Pas de motif précis dans ce groupe")).toBeInTheDocument();
    expect(within(autre).queryByRole("button", { name: "Ajouter un motif" })).not.toBeInTheDocument();
  });

  it("edits a reason's short label and saves only that", async () => {
    mount();
    await userEvent.click(within(card("Commande non réelle")).getByRole("button", { name: "Modifier" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).queryByText("Note obligatoire")).not.toBeInTheDocument();
    const short = within(panel).getByLabelText("Court, en français");
    await userEvent.clear(short);
    await userEvent.type(short, "Pas sérieux");
    expect(within(panel).getByTestId("badge-preview")).toHaveTextContent("Pas sérieux");
    await userEvent.click(within(panel).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings/rejection-reasons/r2");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ short_fr: "Pas sérieux" });
  });

  it("adds a reason to a group, its key made from the French label", async () => {
    mount();
    await userEvent.click(within(card("Injoignable")).getByRole("button", { name: "Ajouter un motif" }));
    const panel = screen.getByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Libellé en français"), "Numéro occupé");
    await userEvent.type(within(panel).getByLabelText("Libellé en arabe"), "الخط مشغول");
    await userEvent.type(within(panel).getByLabelText("Court, en français"), "Occupé");
    await userEvent.type(within(panel).getByLabelText("Court, en arabe"), "مشغول");
    await userEvent.click(within(panel).getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings/rejection-reasons");
    expect(JSON.parse(init.body)).toEqual({
      market_id: LY, parent_key: "injoignable", key: "numero_occupe",
      label_fr: "Numéro occupé", label_ar: "الخط مشغول", short_fr: "Occupé", short_ar: "مشغول", sort_order: 2,
    });
  });

  it("explains that a used reason is retired, not deleted, and retires it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ mode: "retired", usage: 388, data: { id: "r2" } }), { status: 200 }));
    mount();
    await userEvent.click(within(card("Commande non réelle")).getByRole("button", { name: "Modifier" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText(/Utilisé par 388 commandes/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/rejection-reasons/r2", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Motif retiré" })));
  });

  it("moves a reason down with the keyboard and saves the new order", async () => {
    mount();
    const grip = within(card("Injoignable")).getByRole("button", { name: "Déplacer Ne répond pas" });
    fireEvent.keyDown(grip, { key: "ArrowDown" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)]);
    expect(bodies).toEqual(
      expect.arrayContaining([
        ["/api/settings/rejection-reasons/r4", { sort_order: 0 }],
        ["/api/settings/rejection-reasons/r3", { sort_order: 1 }],
      ]),
    );
  });
});
