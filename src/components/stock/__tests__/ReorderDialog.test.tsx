import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ReorderDialog, type ReorderTarget } from "../ReorderDialog";

vi.mock("@/hooks/useWarehouseSites", () => ({
  useWarehouseSites: () => ({
    sites: [
      { id: "w-tripoli", code: "tripoli", name: "Tripoli", isDefault: true, marketId: "m-ly" },
      { id: "w-benghazi", code: "benghazi", name: "Benghazi", isDefault: false, marketId: "m-ly" },
    ],
    mine: null,
    pinned: false,
    unassigned: false,
    isLoading: false,
  }),
}));

vi.mock("swr", () => ({
  default: () => ({
    data: {
      suppliers: [
        { id: "s-1", name: "مكتبة الرسالة", category: "livres", city: "Misrata", is_active: true },
      ],
    },
    isLoading: false,
  }),
}));

function target(over: Partial<ReorderTarget> = {}): ReorderTarget {
  return {
    productId: "p-1",
    productName: "مصحف التهجد و قيام الليل",
    marketId: "m-ly",
    daysOfCover: 9,
    stockOutDate: "2026-10-08",
    freeToSell: 122,
    onOrder: null,
    suggestedQty: 150,
    targetDays: 56,
    ...over,
  };
}

const onDone = vi.fn().mockResolvedValue(undefined);
const onClose = vi.fn();

function wrap(over: Partial<ReorderTarget> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ReorderDialog target={target(over)} onClose={onClose} onDone={onDone} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
});

/**
 * LE BON DE COMMANDE NAÎT DU MANQUE, PRÉ-REMPLI.
 *
 * Personne n'écrira jamais un bon de commande dans un formulaire vide — c'est
 * pour cela qu'`expected_qty` serait resté NULL pour toujours.
 */
describe("ReorderDialog — ce qui est déjà rempli", () => {
  it("propose la quantité calculée, modifiable", () => {
    wrap();
    expect(screen.getByLabelText(/quantité/i)).toHaveValue("150");
  });

  it("dit ce que la commande cherche à couvrir", () => {
    // Un chiffre proposé sans son raisonnement est un ordre ; avec, c'est un
    // point de départ qu'on peut contredire.
    wrap();
    expect(screen.getByText(/56 jours/)).toBeInTheDocument();
  });

  it("rappelle la situation qui a déclenché le geste", () => {
    wrap();
    expect(screen.getByText(/9 jours/)).toBeInTheDocument();
    expect(screen.getByText(/122/)).toBeInTheDocument();
  });

  it("ouvre le champ vide quand la demande est inconnue, et le dit", () => {
    // Proposer un chiffre sans demande mesurée serait une invention présentée
    // comme un calcul.
    wrap({ suggestedQty: null, daysOfCover: null, stockOutDate: null });
    expect(screen.getByLabelText(/quantité/i)).toHaveValue("");
    expect(screen.getByText(/pas de demande mesurée/i)).toBeInTheDocument();
  });
});

describe("ReorderDialog — commander", () => {
  it("envoie fournisseur, bâtiment, quantité et date voulue", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/fournisseur/i), { target: { value: "s-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^commander/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(url).toBe("/api/purchases/orders");
    expect(JSON.parse(init.body as string)).toMatchObject({
      supplier_id: "s-1",
      warehouse_id: "w-tripoli",
      wanted_by: "2026-10-08",
      lines: [{ product_id: "p-1", qty: 150, unit_cost: null }],
    });
  });

  it("refuse de commander sans fournisseur, sans appeler le serveur", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /^commander/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuse une quantité vide ou nulle", () => {
    wrap({ suggestedQty: null });
    fireEvent.change(screen.getByLabelText(/fournisseur/i), { target: { value: "s-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^commander/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("laisse le prix à null quand personne ne l'a convenu", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/fournisseur/i), { target: { value: "s-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^commander/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(JSON.parse(init.body as string).lines[0].unit_cost).toBeNull();
  });

  it("transmet un prix annoncé quand on le saisit", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/fournisseur/i), { target: { value: "s-1" } });
    fireEvent.change(screen.getByLabelText(/prix annoncé/i), { target: { value: "85,500" } });
    fireEvent.click(screen.getByRole("button", { name: /^commander/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    // La virgule décimale est acceptée : c'est ce qu'on tape en français.
    expect(JSON.parse(init.body as string).lines[0].unit_cost).toBe(85.5);
  });

  it("montre le refus du serveur au lieu de se fermer en silence", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Ce fournisseur appartient à un autre marché" }),
    }) as never;
    wrap();
    fireEvent.change(screen.getByLabelText(/fournisseur/i), { target: { value: "s-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^commander/i }));
    expect(await screen.findByText(/un autre marché/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
