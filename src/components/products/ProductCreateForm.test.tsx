import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), val);
      return val;
    };
    return resolve;
  },
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockDecode = vi.fn();
vi.mock("@/lib/client/image", () => ({
  decodeImageFile: (...args: unknown[]) => mockDecode(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ProductCreateForm } from "./ProductCreateForm";

const markets = [
  { id: "m-1", name: "Tunisie" },
  { id: "m-2", name: "Libye" },
];

function renderForm(overrides: Partial<React.ComponentProps<typeof ProductCreateForm>> = {}) {
  const defaults: React.ComponentProps<typeof ProductCreateForm> = {
    role: "super_admin",
    markets,
    defaultMarketId: "m-1",
    locale: "fr",
  };
  return render(<ProductCreateForm {...defaults} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProductCreateForm", () => {
  it("renders the form title", () => {
    renderForm();
    expect(screen.getByText("Nouveau produit")).toBeInTheDocument();
  });

  // Chaque section apparaît deux fois — onglet de navigation et titre de
  // section — depuis l'alignement sur le formulaire d'édition. On vise le
  // titre par son rôle plutôt que le texte nu, qui est ambigu.
  it("renders all three sections", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "Identité" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Modèle de coûts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Inventaire" })).toBeInTheDocument();
  });

  it("links each section from the form nav", () => {
    renderForm();
    const nav = screen.getByRole("navigation", { name: "Sections du formulaire" });
    expect(within(nav).getByRole("link", { name: /Identité/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Modèle de coûts/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Inventaire/ })).toBeInTheDocument();
  });

  it("shows validation error when name is empty on submit", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));
    expect(await screen.findByText(/nom est obligatoire/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows validation error when unit_cogs is negative", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogsInput = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogsInput);
    await userEvent.type(cogsInput, "-5");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));
    expect(await screen.findByText(/cogs unitaire invalide/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("submits and redirects to product detail on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm();

    await userEvent.type(screen.getByLabelText("Nom du produit"), "Test produit");
    const cogsInput = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogsInput);
    await userEvent.type(cogsInput, "10");

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ method: "POST" })
    ));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/new-prod-id"));
  });

  it("shows API error when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Erreur serveur" }),
    });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Produit test");
    const cogsInput = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogsInput);
    await userEvent.type(cogsInput, "10");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  it("cancel navigates back to products list", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(mockPush).toHaveBeenCalledWith("/fr/products");
  });

  it("submits the SKU when the user types one", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.type(screen.getByLabelText(/SKU/i), "BV-01");

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sku).toBe("BV-01");
  });

  it("hides the market select when lockedMarketId is set", () => {
    renderForm({ lockedMarketId: "m-2" });
    expect(screen.queryByLabelText("Marché")).not.toBeInTheDocument();
  });

  it("submits the locked market_id even when multiple markets are passed in", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm({ lockedMarketId: "m-2" });

    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.market_id).toBe("m-2");
  });

  it("still shows the market select when lockedMarketId is null (scope=all)", () => {
    renderForm({ lockedMarketId: null });
    expect(screen.getByLabelText("Marché")).toBeInTheDocument();
  });

  it("renders the image picker in the identity section", () => {
    renderForm();
    expect(screen.getByText("Ajouter une image")).toBeInTheDocument();
  });

  it("uploads the picked image after the product is created", async () => {
    mockDecode.mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,AAA" });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "new-prod-id" } }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_url: "https://cdn/p.png" }) }); // image PUT

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.upload(
      screen.getByTestId("product-image-input"),
      new File(["x"], "p.png", { type: "image/png" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/products");
    expect(mockFetch.mock.calls[1][0]).toBe("/api/products/new-prod-id/image");
    const imageBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(imageBody.data_url).toBe("data:image/png;base64,AAA");

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/new-prod-id"));
  });

  it("does not call the image route when no image is picked", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "new-prod-id" } }) });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");
    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch.mock.calls.some((c) => String(c[0]).endsWith("/image"))).toBe(false);
  });

  it("omits sku from body when left blank", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "new-prod-id" } }),
    });

    renderForm();
    await userEvent.type(screen.getByLabelText("Nom du produit"), "Mon produit");
    const cogs = screen.getByLabelText("COGS unitaire");
    await userEvent.clear(cogs);
    await userEvent.type(cogs, "10");

    await userEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sku).toBeUndefined();
  });
});

/*
 * LE POINT DÉLICAT DU PROTOTYPE.
 *
 * L'interrupteur est ÉTEINT par défaut : 12 des 13 produits du catalogue n'ont
 * pas de variantes et ne doivent pas payer le prix de la nouveauté.
 *
 * Allumé, le coût, le prix, le SKU et le stock DISPARAISSENT du produit pour
 * réapparaître dans le tableau des tailles. Ils ne peuvent pas vivre aux deux
 * endroits, sinon personne ne sait lequel fait foi — et c'est le produit que
 * lisent les finances quand aucune variante n'est nommée.
 */
describe("ProductCreateForm — créer un produit qui se décline", () => {
  const V = frMessages.products.create.variants;

  async function enableVariants(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("switch", { name: V.toggle }));
  }

  it("l'interrupteur est éteint par défaut", () => {
    renderForm();
    expect(screen.getByRole("switch", { name: V.toggle })).not.toBeChecked();
    expect(screen.getByText(V.off)).toBeInTheDocument();
  });

  it("allumé, le coût, le prix et le SKU quittent le produit", async () => {
    const user = userEvent.setup();
    renderForm();
    await enableVariants(user);

    expect(screen.queryByLabelText("COGS unitaire")).toBeNull();
    // « SKU » et « Stock initial » nomment AUSSI des colonnes de variante : on
    // vérifie donc qu'il n'en reste aucun HORS d'une ligne de variante, pas
    // qu'il n'en reste aucun du tout.
    expect(
      screen.getAllByLabelText("SKU").every((el) => el.closest('[role="group"]')),
    ).toBe(true);
    expect(screen.getByText(V.moved)).toBeInTheDocument();
    // Ce qui ne varie pas reste.
    expect(screen.getByLabelText("Coût d'emballage")).toBeInTheDocument();
  });

  it("allumé, le stock initial du produit n'est plus saisissable", async () => {
    const user = userEvent.setup();
    renderForm();
    await enableVariants(user);
    expect(
      screen.getAllByLabelText("Stock initial").every((el) => el.closest('[role="group"]')),
    ).toBe(true);
  });

  it("envoie les variantes, et pas de coût produit", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "p-new" }, variants_created: 1 }),
    });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Nom du produit"), "دميه ملاكمه");
    await enableVariants(user);
    await user.type(screen.getByLabelText(V.columns.label), "Grand");
    await user.type(screen.getByLabelText(V.columns.displayPrice), "199");
    const cogs = screen.getByLabelText(V.columns.unitCogs);
    await user.type(cogs, "30");
    const stock = screen.getByLabelText(V.columns.initialStock);
    await user.clear(stock);
    await user.type(stock, "600");

    await user.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.variants).toEqual([
      {
        label: "Grand",
        sku: null,
        unit_cogs: 30,
        display_price: 199,
        initial_stock: 600,
      },
    ]);
  });

  it("refuse une variante sans nom, sans appeler le serveur", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Nom du produit"), "Produit");
    await enableVariants(user);
    await user.type(screen.getByLabelText(V.columns.displayPrice), "199");
    await user.click(screen.getByRole("button", { name: "Créer le produit" }));

    expect(await screen.findByText(V.errors.labelRequired)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuse une variante sans prix, sans appeler le serveur", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Nom du produit"), "Produit");
    await enableVariants(user);
    await user.type(screen.getByLabelText(V.columns.label), "Grand");
    await user.click(screen.getByRole("button", { name: "Créer le produit" }));

    expect(await screen.findByText(V.errors.priceRequired)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  /*
   * Éteint, rien ne change : pas de clé `variants` dans le corps, et le COGS
   * produit redevient obligatoire. C'est le chemin que 12 produits sur 13
   * empruntent.
   */
  it("éteint, le corps ne porte aucune variante", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { id: "p-new" } }) });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Nom du produit"), "Biovera");
    const cogs = screen.getByLabelText("COGS unitaire");
    await user.clear(cogs);
    await user.type(cogs, "12");
    await user.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("variants");
    expect(body.unit_cogs).toBe(12);
  });

  /*
   * 207 = le produit existe, une variante a échoué. On ne peut pas revenir en
   * arrière sans transaction, donc on emmène l'auteur sur la fiche produit
   * AVEC le message : il saura quoi finir à la main plutôt que de croire que
   * rien n'a été créé et recommencer.
   */
  it("un 207 emmène sur la fiche produit en montrant ce qui manque", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 207,
      json: async () => ({
        data: { id: "p-half" },
        variants_created: 1,
        error: "Le SKU de la variante « Grand » est déjà utilisé",
      }),
    });
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Nom du produit"), "Produit");
    await enableVariants(user);
    await user.type(screen.getByLabelText(V.columns.label), "Grand");
    await user.type(screen.getByLabelText(V.columns.displayPrice), "199");
    await user.click(screen.getByRole("button", { name: "Créer le produit" }));

    expect(
      await screen.findByText(/Le SKU de la variante/),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/p-half"));
  });
});
