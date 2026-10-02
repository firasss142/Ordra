import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

const swrData = new Map<string, unknown>();
vi.mock("swr", () => ({
  default: (key: string | null) => ({ data: key ? swrData.get(key) : undefined }),
}));

import { ReceptionCreateDialog } from "../ReceptionCreateDialog";

function wrap(role = "market_manager") {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ReceptionCreateDialog role={role as never} onClose={vi.fn()} onCreated={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  swrData.clear();
  swrData.set("/api/warehouse/sites", {
    sites: [{ id: "w-tripoli", code: "tripoli", name: "Tripoli", isDefault: true }],
    mine: null,
    pinned: false,
    unassigned: false,
  });
  swrData.set("/api/products/search?q=qur", {
    data: [{ id: "p1", name: "القرآن تدبر وعمل", sku: "qr-01", current_stock: 943 }],
  });
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ id: "r-new" }) }) as never;
});

/**
 * L'ÉCRAN DE CRÉATION — maquette §2. La v1 de la maquette montrait la lecture
 * mais jamais l'écriture : on ne voyait pas comment une réception naît.
 */
describe("ReceptionCreateDialog — le sélecteur de lignes", () => {
  it("nomme les deux colonnes numériques", () => {
    wrap();
    expect(screen.getByText(/^Quantité$/)).toBeInTheDocument();
    expect(screen.getByText(/^Coût unit\.$/)).toBeInTheDocument();
  });

  it("offre « Ajouter une ligne », qui met le curseur dans la recherche", () => {
    wrap();
    const add = screen.getByRole("button", { name: /ajouter une ligne/i });
    fireEvent.click(add);
    expect(screen.getByPlaceholderText(/chercher un produit/i)).toHaveFocus();
  });

  /*
   * « qr-01 · en stock 943 ». Deux produits peuvent porter un nom proche ; la
   * référence les sépare, et le stock actuel dit si cette réception est un
   * réassort ou un doublon qu'on s'apprête à commander pour rien.
   */
  it("montre la référence et le stock actuel du produit choisi", async () => {
    wrap();
    fireEvent.change(screen.getByPlaceholderText(/chercher un produit/i), {
      target: { value: "qur" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ }));
    expect(screen.getByText(/qr-01/)).toBeInTheDocument();
    expect(screen.getByText(/en stock 943/)).toBeInTheDocument();
  });

  it("dit que le n° de bon de livraison est celui du fournisseur", () => {
    wrap();
    expect(screen.getByText(/leur numéro, pas le nôtre/i)).toBeInTheDocument();
  });
});

/**
 * LA COLONNE COÛT N'EXISTE PAS POUR UN AGENT D'ENTREPÔT — et ce n'est pas qu'une
 * affaire d'écran : la route force `unit_cost` à NULL quand l'appelant est un
 * agent, donc l'interface n'est pas l'autorité.
 */
describe("ReceptionCreateDialog — le coût selon qui crée", () => {
  it("ne rend ni colonne ni libellé de coût pour un agent", () => {
    wrap("warehouse_agent");
    expect(screen.queryByText(/^Coût unit\.$/)).not.toBeInTheDocument();
  });

  it("le rend pour un manager", () => {
    wrap("market_manager");
    expect(screen.getByText(/^Coût unit\.$/)).toBeInTheDocument();
  });
});

describe("ReceptionCreateDialog — ce qui part au serveur", () => {
  it("laisse une quantité non saisie à null — « non annoncé », pas zéro", async () => {
    wrap();
    fireEvent.change(screen.getByPlaceholderText(/chercher un produit/i), {
      target: { value: "qur" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ }));
    fireEvent.click(screen.getByRole("button", { name: /créer le brouillon/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.lines[0].expected_qty).toBeNull();
  });
});
