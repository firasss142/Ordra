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
    sites: [
      { id: "w-tripoli", code: "tripoli", name: "Tripoli", isDefault: true, marketId: "m-ly" },
    ],
    mine: null,
    pinned: false,
    unassigned: false,
  });
  swrData.set("/api/products/search?market_id=m-ly&q=qur", {
    data: [{ id: "p1", name: "القرآن تدبر وعمل", sku: "qr-01", current_stock: 943 }],
  });
  const dollCatalogue = {
    data: [
      {
        id: "p-doll",
        name: "دميه ملاكمه",
        sku: "box-wafra-shop",
        current_stock: 208,
        product_variants: [
          { id: "v-s", label: "صغير", kind: "attribute", current_stock: 42, is_active: true },
          { id: "v-m", label: "متوسط", kind: "attribute", current_stock: 98, is_active: true },
          { id: "v-l", label: "كبير", kind: "attribute", current_stock: 68, is_active: true },
          { id: "v-pack6", label: "Pack de 6", kind: "pack", current_stock: 0, is_active: true },
          { id: "v-old", label: "ancienne taille", kind: "attribute", current_stock: 0, is_active: false },
        ],
      },
    ],
  };
  swrData.set("/api/products/search?market_id=m-ly", dollCatalogue);
  swrData.set("/api/products/search?market_id=m-ly&q=mal", {
    data: [
      {
        id: "p-doll",
        name: "دميه ملاكمه",
        sku: "box-wafra-shop",
        current_stock: 208,
        product_variants: [
          { id: "v-s", label: "صغير", kind: "attribute", current_stock: 42, is_active: true },
          { id: "v-m", label: "متوسط", kind: "attribute", current_stock: 98, is_active: true },
          { id: "v-l", label: "كبير", kind: "attribute", current_stock: 68, is_active: true },
          // Un palier n'est pas un objet sur une étagère : il ne se reçoit pas.
          { id: "v-pack6", label: "Pack de 6", kind: "pack", current_stock: 0, is_active: true },
          // Une variante retirée du catalogue n'est pas proposée.
          { id: "v-old", label: "ancienne taille", kind: "attribute", current_stock: 0, is_active: false },
        ],
      },
    ],
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
    swrData.set(`/api/products/search?market_id=m-ly&q=${encodeURIComponent("القرآن")}`, {
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
    swrData.set("/api/products/search?market_id=m-ly&q=biovera", { data: [] });
    wrap();
    type("biovera");
    expect(await screen.findByText(/aucun produit actif ne correspond/i)).toBeInTheDocument();
    expect(screen.getByText(/biovera/)).toBeInTheDocument();
  });

  it("compte les résultats", async () => {
    swrData.set("/api/products/search?market_id=m-ly&q=kit", {
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
    swrData.set("/api/products/search?market_id=m-ly&q=kit", {
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

/**
 * LA LISTE S'OUVRE AU FOCUS, AVANT QU'ON AIT TAPÉ.
 *
 * Chercher suppose qu'on sache déjà quoi chercher. Devant un bon de livraison on
 * reconnaît un produit plus vite qu'on ne l'épelle — surtout un titre arabe —
 * donc le catalogue du bâtiment s'ouvre dès que le champ prend le focus, et la
 * frappe le FILTRE au lieu de le faire apparaître.
 */
describe("ReceptionCreateDialog — le catalogue au focus", () => {
  const CATALOGUE = {
    data: [
      { id: "p1", name: "القرآن تدبر وعمل", sku: "qr-01", current_stock: 943 },
      { id: "p2", name: "مصحف التهجد", sku: "th-01", current_stock: 0 },
    ],
  };

  beforeEach(() => {
    swrData.set("/api/products/search?market_id=m-ly", CATALOGUE);
  });

  function field() {
    return screen.getByPlaceholderText(/chercher un produit/i);
  }

  it("ne montre rien tant que le champ n'a pas le focus", () => {
    wrap();
    expect(screen.queryByRole("button", { name: /القرآن تدبر وعمل/ })).not.toBeInTheDocument();
  });

  it("ouvre le catalogue du bâtiment au focus", async () => {
    wrap();
    fireEvent.focus(field());
    expect(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /مصحف التهجد/ })).toBeInTheDocument();
  });

  it("permet d'ajouter une ligne sans rien taper", async () => {
    wrap();
    fireEvent.focus(field());
    fireEvent.click(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ }));
    // La ligne posée porte la référence ET le stock ; la liste, elle, reste
    // ouverte pour le produit suivant — d'où la précision de l'assertion.
    expect(screen.getByText(/qr-01 · en stock 943/)).toBeInTheDocument();
  });

  /* Enchaîner dix lignes sans jamais refermer la liste est tout l'intérêt. */
  it("reste ouverte après un ajout, en marquant ce qui est déjà pris", async () => {
    wrap();
    fireEvent.focus(field());
    fireEvent.click(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ }));
    expect(screen.getByText(/déjà sur cette réception/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /مصحف التهجد/ })).toBeInTheDocument();
  });

  /* Taper FILTRE une liste déjà ouverte — ce n'est pas elle qui la fait naître. */
  it("bascule sur les résultats de recherche dès deux lettres", async () => {
    wrap();
    fireEvent.focus(field());
    await screen.findByRole("button", { name: /مصحف التهجد/ });
    fireEvent.change(field(), { target: { value: "qur" } });
    expect(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ })).toBeInTheDocument();
    // La liste du catalogue a laissé place aux résultats : le second produit sort.
    expect(screen.queryByRole("button", { name: /مصحف التهجد/ })).not.toBeInTheDocument();
  });

  it("revient au catalogue quand on efface", async () => {
    wrap();
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "qur" } });
    await screen.findByRole("button", { name: /القرآن تدبر وعمل/ });
    fireEvent.change(field(), { target: { value: "" } });
    expect(await screen.findByRole("button", { name: /مصحف التهجد/ })).toBeInTheDocument();
  });

  it("Échap referme la liste ouverte au focus", async () => {
    wrap();
    fireEvent.focus(field());
    await screen.findByRole("button", { name: /مصحف التهجد/ });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("button", { name: /مصحف التهجد/ })).not.toBeInTheDocument();
  });

  it("marque déjà ajouté dans le catalogue aussi", async () => {
    wrap();
    fireEvent.focus(field());
    fireEvent.click(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ }));
    fireEvent.focus(field());
    expect(await screen.findByText(/déjà sur cette réception/i)).toBeInTheDocument();
  });
});

/**
 * LE MARCHÉ VIENT DU BÂTIMENT.
 *
 * `/api/products/search` résout le marché comme `?market_id ?? actor.market_id`
 * et rend une liste VIDE sans l'un ni l'autre. Les deux super_admin de production
 * ont `market_id` NULL : sans ce paramètre, aucun d'eux ne pouvait ajouter une
 * seule ligne à une réception. Le bâtiment est la bonne source, et c'est déjà la
 * règle du domaine côté serveur.
 */
describe("ReceptionCreateDialog — le marché du produit", () => {
  it("cherche dans le marché du bâtiment choisi", async () => {
    swrData.set("/api/products/search?market_id=m-ly", { data: [] });
    wrap("super_admin");
    fireEvent.focus(screen.getByPlaceholderText(/chercher un produit/i));
    // Rien ne doit être demandé sans market_id : ce serait la liste vide.
    expect(swrData.has("/api/products/search")).toBe(false);
    expect(await screen.findByText(/aucun produit actif/i)).toBeInTheDocument();
  });
});

/**
 * LA VARIANTE EST LE GRAIN OÙ VIT LE STOCK.
 *
 * `product_site_stock` est unique sur (product_id, variant_id, warehouse_id), et
 * `reception_lines.variant_id` existe depuis le premier jour — mais le sélecteur
 * envoyait toujours NULL. Recevoir 50 M et 50 L déclarait donc 100 unités de
 * « produit nu », qui atterrissent dans le NON VENTILÉ ; et sur un produit
 * ventilé à 100 %, `scan_order_out` refuse ensuite de les sortir
 * (« quelle taille le client a-t-il reçue ? » n'a pas de réponse).
 *
 * Le module créait donc du stock que le reste d'Ordra ne savait pas vendre.
 */
describe("ReceptionCreateDialog — les variantes", () => {
  async function search(term: string) {
    wrap();
    fireEvent.change(screen.getByPlaceholderText(/chercher un produit/i), {
      target: { value: term },
    });
  }

  it("n'offre PAS le produit nu quand il est ventilé", async () => {
    await search("mal");
    await screen.findByText("دميه ملاكمه");
    // Le nom paraît comme en-tête de groupe, jamais comme bouton choisissable.
    expect(screen.queryByRole("button", { name: /^دميه ملاكمه$/ })).not.toBeInTheDocument();
  });

  it("propose chaque taille, avec son propre stock", async () => {
    await search("mal");
    expect(await screen.findByRole("button", { name: /صغير/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /متوسط/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /كبير/ })).toBeInTheDocument();
    // 42 et non 208 : c'est le stock de CETTE taille qui dit s'il en manque.
    expect(screen.getByRole("button", { name: /صغير/ })).toHaveTextContent("42");
  });

  it("n'offre pas les paliers : un pack n'est pas un objet sur une étagère", async () => {
    await search("mal");
    await screen.findByText("دميه ملاكمه");
    expect(screen.queryByRole("button", { name: /Pack de 6/ })).not.toBeInTheDocument();
  });

  it("n'offre pas une variante désactivée", async () => {
    await search("mal");
    await screen.findByText("دميه ملاكمه");
    expect(screen.queryByRole("button", { name: /ancienne taille/ })).not.toBeInTheDocument();
  });

  it("la ligne ajoutée porte le nom de la variante", async () => {
    await search("mal");
    fireEvent.click(await screen.findByRole("button", { name: /متوسط/ }));
    // Une seule ligne posée, et elle nomme la taille. Le catalogue reste ouvert
    // (on saisit dix lignes d'affilée), donc l'étiquette paraît aussi là-bas —
    // on compte les LIGNES, pas les occurrences du texte.
    expect(screen.getAllByRole("button", { name: /retirer la ligne/i })).toHaveLength(1);
    const posted = screen.getAllByRole("button", { name: /retirer la ligne/i })[0].closest("div");
    expect(posted?.parentElement?.textContent).toContain("متوسط");
  });

  it("deux tailles du même produit font deux lignes", async () => {
    await search("mal");
    fireEvent.click(await screen.findByRole("button", { name: /صغير/ }));
    fireEvent.click(screen.getByRole("button", { name: /كبير/ }));
    // L'index unique est (reception_id, product_id, variant_id) : deux tailles
    // sont deux lignes légitimes, pas un doublon. Les deux étiquettes paraissent
    // donc à la fois dans la liste et sur les lignes posées.
    expect(screen.getAllByRole("button", { name: /retirer la ligne/i })).toHaveLength(2);
  });

  it("envoie le variant_id au serveur", async () => {
    await search("mal");
    fireEvent.click(await screen.findByRole("button", { name: /متوسط/ }));
    fireEvent.click(screen.getByRole("button", { name: /créer le brouillon/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (global.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls.at(-1)![1].body,
    );
    expect(body.lines[0]).toMatchObject({ product_id: "p-doll", variant_id: "v-m" });
  });

  it("un produit sans variante reste choisissable tel quel, avec variant_id null", async () => {
    await search("qur");
    fireEvent.click(await screen.findByRole("button", { name: /القرآن تدبر وعمل/ }));
    fireEvent.click(screen.getByRole("button", { name: /créer le brouillon/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (global.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls.at(-1)![1].body,
    );
    expect(body.lines[0]).toMatchObject({ product_id: "p1", variant_id: null });
  });
});
