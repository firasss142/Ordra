import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

const swrData = new Map<string, unknown>();
vi.mock("swr", () => ({
  default: (key: string | null) => ({
    data: key ? swrData.get(key) : undefined,
    isLoading: key ? !swrData.has(key) : false,
  }),
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

/**
 * LA RECHERCHE DE PRODUIT EN DIRECT — maquette v3 §5 et §5b.
 *
 * Un champ de recherche vit surtout dans ses états vides : rien tapé, une seule
 * lettre, requête en cours, aucun résultat, déjà ajouté. La version précédente
 * n'en dessinait aucun et retirait silencieusement de la liste les produits déjà
 * posés — on tapait un nom, rien n'apparaissait, et on en concluait que le
 * produit n'existait pas.
 */
describe("ReceptionCreateDialog — la recherche en direct", () => {
  function type(value: string) {
    fireEvent.change(screen.getByPlaceholderText(/chercher un produit/i), { target: { value } });
  }

  it("ne cherche pas sur une seule lettre, et le dit", () => {
    wrap();
    type("ق");
    expect(screen.getByText(/encore une lettre/i)).toBeInTheDocument();
  });

  it("montre la référence et le stock de chaque résultat", async () => {
    wrap();
    type("qur");
    expect(await screen.findByText(/qr-01/)).toBeInTheDocument();
    expect(screen.getByText(/en stock 943/)).toBeInTheDocument();
  });

  it("met la correspondance en gras plutôt qu'en couleur", async () => {
    // La clé SWR porte la requête ENCODÉE : un nom arabe n'y apparaît pas en clair.
    swrData.set(`/api/products/search?q=${encodeURIComponent("القرآن")}`, {
      data: [{ id: "p1", name: "القرآن تدبر وعمل", sku: "qr-01", current_stock: 943 }],
    });
    wrap();
    type("القرآن");
    const marks = await waitFor(() => {
      const found = document.querySelectorAll("mark");
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(marks[0]).toHaveTextContent("القرآن");
  });

  /*
   * Le cœur du correctif. Un produit déjà posé RESTE visible et dit pourquoi il
   * ne peut pas être ajouté deux fois — l'index unique (réception, produit,
   * variante) le refuserait bien plus tard, loin du geste.
   */
  it("garde visible un produit déjà ajouté, en disant pourquoi", async () => {
    wrap();
    type("qur");
    fireEvent.click(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ }));

    type("qur");
    expect(await screen.findByText(/déjà sur cette réception/i)).toBeInTheDocument();
    // Et il n'est plus cliquable : un deuxième clic n'ajoute pas une deuxième ligne.
    expect(screen.queryByRole("button", { name: /القرآن تدبر وعمل/ })).not.toBeInTheDocument();
  });

  it("dit qu'il n'a rien trouvé, et nomme ce qu'on a cherché", async () => {
    swrData.set("/api/products/search?q=biovera", { data: [] });
    wrap();
    type("biovera");
    expect(await screen.findByText(/aucun produit actif ne correspond/i)).toBeInTheDocument();
    expect(screen.getByText(/biovera/)).toBeInTheDocument();
  });

  it("compte les résultats", async () => {
    swrData.set("/api/products/search?q=kit", {
      data: [
        { id: "p1", name: "Kit A", sku: "a-1", current_stock: 5 },
        { id: "p2", name: "Kit B", sku: "b-1", current_stock: 0 },
      ],
    });
    wrap();
    type("kit");
    expect(await screen.findByText(/2 produits actifs/i)).toBeInTheDocument();
  });
});

/**
 * LE CLAVIER. Un magasinier qui saisit dix lignes ne doit pas lâcher le clavier
 * pour viser une ligne à la souris entre chaque produit.
 */
describe("ReceptionCreateDialog — au clavier", () => {
  beforeEach(() => {
    swrData.set("/api/products/search?q=kit", {
      data: [
        { id: "p1", name: "Kit A", sku: "a-1", current_stock: 5 },
        { id: "p2", name: "Kit B", sku: "b-1", current_stock: 9 },
      ],
    });
  });

  function search() {
    return screen.getByPlaceholderText(/chercher un produit/i);
  }

  it("Entrée ajoute le résultat survolé", async () => {
    wrap();
    fireEvent.change(search(), { target: { value: "kit" } });
    await screen.findByRole("button", { name: /Kit A/ });
    fireEvent.keyDown(search(), { key: "Enter" });
    // La ligne est posée et la recherche se vide pour le produit suivant.
    expect(screen.getByText(/a-1/)).toBeInTheDocument();
    expect(search()).toHaveValue("");
  });

  it("la flèche bas descend d'un résultat avant d'ajouter", async () => {
    wrap();
    fireEvent.change(search(), { target: { value: "kit" } });
    await screen.findByRole("button", { name: /Kit B/ });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(screen.getByText(/b-1/)).toBeInTheDocument();
  });

  /* Échap ferme la liste sans fermer la modale : on perdrait la saisie entière. */
  it("Échap ferme les résultats sans fermer la modale", async () => {
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <ReceptionCreateDialog role={"market_manager" as never} onClose={onClose} onCreated={vi.fn()} />
      </NextIntlClientProvider>,
    );
    const field = screen.getByPlaceholderText(/chercher un produit/i);
    fireEvent.change(field, { target: { value: "kit" } });
    await screen.findByRole("button", { name: /Kit A/ });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /Kit A/ })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
