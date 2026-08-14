import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

/**
 * The `products.editV2.*` group does not live in src/messages/*.json yet — a
 * dedicated merge agent inserts it at the same index in fr.json and ar.json.
 * Until then the translation mock overlays it, so these assertions read as the
 * French the reviewer will actually see instead of as raw key paths.
 */
const editV2Fr = {
  intro:
    "Identité, fiche agent, modèle de coût et statut. Les champs verrouillés dépendent de votre rôle.",
  asideLabel: "Aperçus",
  nav: { label: "Sections du formulaire" },
  sections: { composition: "Composition et utilisation" },
  hints: {
    identity: "Nom affiché partout dans la console et sur les bordereaux transporteur.",
    agentSheet:
      "Ce bloc s'affiche à l'agent pendant l'appel. Un brief court en haut, le détail en dessous. La colonne latérale montre le rendu en direct.",
    composition:
      "Les trois champs que l'agent déplie quand le client pose une question précise.",
    costModel: "Ces champs alimentent chaque calcul de rentabilité du produit.",
    stockStatus:
      "Le stock ne se modifie pas ici — il passe par « Ajuster le stock », qui écrit une ligne au journal d'inventaire.",
    currentStock: "Lecture seule — le stock passe par l'ajustement d'inventaire.",
    isActive: "Visible dans la file des agents et acceptant de nouvelles commandes.",
  },
  permission: {
    superAdmin: "Super admin",
    marketManager: "Manager du marché",
    requiredRole: "Rôle requis : {role}",
  },
  fields: { currentStock: "Stock actuel" },
  variants: {
    title: "Notes par pack",
    hint: "Une ligne par pack, lue par l'agent au moment de proposer la quantité.",
  },
  margin: {
    title: "Marge unitaire — en direct",
    price: "Prix catalogue",
    cogs: "− Coût unitaire",
    packing: "− Emballage",
    processing: "− Traitement",
    delivery: "− Livraison (moy. réelle)",
    total: "Marge par livraison",
    note: "Frais de livraison moyens observés sur les livraisons réelles de ce produit. Les retours ne sont pas dans ce calcul unitaire — ils apparaissent dans le profit net de la fiche.",
    noDeliveryFee: "Frais de livraison moyens indisponibles — cette marge ne les déduit pas.",
    noPrice: "Renseignez un prix catalogue pour voir la marge.",
  },
  preview: {
    title: "Aperçu agent",
    emptyBrief: "Brief vide — l'agent ne verra rien ici",
    emptyNotes:
      "Les notes détaillées s'afficheront ici, sous le nom du produit, dans la fiche que l'agent ouvre pendant l'appel.",
  },
  impact: {
    title: "Impact",
    body: "Changer le coût unitaire recalcule le profit net de toutes les livraisons passées — la marge historique bougera dans le tableau de bord.",
    inFlight: "Ce produit a {count} commande(s) en cours chez le transporteur.",
  },
  savebar: {
    label: "Enregistrement",
    clean: "Aucune modification en attente",
    dirty: "Modifications non enregistrées",
  },
};

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const walk = (root: unknown, path: string) => {
      let val: unknown = root;
      for (const p of path.split(".")) val = (val as Record<string, unknown>)?.[p];
      return val;
    };
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const full = namespace ? `${namespace}.${key}` : key;
      let val = walk(frMessages, full);
      if (typeof val !== "string") val = walk({ products: { editV2: editV2Fr } }, full);
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val,
        );
      return val;
    };
    return resolve;
  },
}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// The picker decodes via canvas; stub it so picking yields a deterministic data URL.
const mockDecode = vi.fn();
vi.mock("@/lib/client/image", () => ({
  decodeImageFile: (...args: unknown[]) => mockDecode(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ProductEditForm } from "./ProductEditForm";

/** Widened from the component's own prop type: `sku: null` alone would infer
 *  `null`, and an override such as `default_price: 129` would not type-check. */
type FormProduct = React.ComponentProps<typeof ProductEditForm>["product"];

const baseProduct: FormProduct = {
  id: "p-1",
  name: "Bouteille",
  sku: null,
  description: null,
  image_url: null,
  agent_brief: null,
  agent_brief_tone: "info" as const,
  agent_notes: null,
  agent_composition: null,
  agent_contraindications: null,
  agent_usage: null,
  cross_sell_product_id: null,
  floor_price: null,
  unit_cogs: 5,
  packing_cost: 1,
  confirmation_processing_cost: 0,
  default_price: null,
  low_stock_threshold: 5,
  is_active: true,
};

type Variant = { id: string; label: string; agent_note: string | null };

function renderForm(
  overrides: Partial<FormProduct> = {},
  {
    canManageCosts = true,
    variants = [] as Variant[],
    crossSellOptions = [] as { id: string; name: string }[],
    avgDeliveryFee,
    currencySymbol,
    currentStock,
    inFlightCount,
  }: {
    canManageCosts?: boolean;
    variants?: Variant[];
    crossSellOptions?: { id: string; name: string }[];
    avgDeliveryFee?: number;
    currencySymbol?: string;
    currentStock?: number;
    inFlightCount?: number;
  } = {},
) {
  return render(
    <ProductEditForm
      product={{ ...baseProduct, ...overrides }}
      locale="fr"
      canManageCosts={canManageCosts}
      variants={variants}
      crossSellOptions={crossSellOptions}
      avgDeliveryFee={avgDeliveryFee}
      currencySymbol={currencySymbol}
      currentStock={currentStock}
      inFlightCount={inFlightCount}
    />,
  );
}

/** Every successful save ends with the agent-content PUT. */
function okResponse() {
  return { ok: true, json: async () => ({ success: true }) };
}

/** The save button only wakes up once something changed. */
async function makeDirty() {
  await userEvent.type(screen.getByLabelText("À savoir (épinglé)"), "x");
}

const saveButton = () => screen.getByRole("button", { name: "Enregistrer" });

beforeEach(() => {
  vi.clearAllMocks();
});

/* ════════════════ CONTRAT RÉSEAU — inchangé par la refonte ════════════════ */

describe("ProductEditForm — image upload", () => {
  it("renders the image picker", () => {
    renderForm();
    expect(screen.getByText("Image du produit")).toBeInTheDocument();
    expect(screen.getByText("Ajouter une image")).toBeInTheDocument();
  });

  it("uploads the picked image after the product PATCH succeeds", async () => {
    mockDecode.mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,AAA" });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) }) // PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_url: "https://cdn/p.png" }) }) // image PUT
      .mockResolvedValueOnce(okResponse()); // agent-content PUT

    renderForm();

    await userEvent.upload(
      screen.getByTestId("product-image-input"),
      new File(["x"], "p.png", { type: "image/png" }),
    );

    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1");
    expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");

    expect(mockFetch.mock.calls[1][0]).toBe("/api/products/p-1/image");
    expect(mockFetch.mock.calls[1][1].method).toBe("PUT");
    const imageBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(imageBody.data_url).toBe("data:image/png;base64,AAA");

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/fr/products/p-1"));
  });

  it("does not call the image route when no new image is picked", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();
    await makeDirty();
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1");
    // No image PUT
    expect(mockFetch.mock.calls.some((c) => String(c[0]).endsWith("/image"))).toBe(false);
  });

  it("clears the image through the PATCH when the picker is emptied", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm({ image_url: "https://cdn/old.png" });
    await userEvent.click(screen.getByRole("button", { name: "Supprimer l'image" }));
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).image_url).toBe("");
  });
});

describe("ProductEditForm — agent sheet authoring", () => {
  it("sends the agent content to its own route, separate from the cost PATCH", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();

    await userEvent.type(
      screen.getByLabelText("À savoir (épinglé)"),
      "Stock bleu épuisé",
    );
    await userEvent.type(screen.getByLabelText("Notes internes"), "Pack 2 à 79");
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("/api/products/p-1/agent-content");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.agent_brief).toBe("Stock bleu épuisé");
    expect(body.agent_notes).toBe("Pack 2 à 79");
    expect(body.agent_brief_tone).toBe("info");
    // Costs must never ride along on the content route.
    expect(body.unit_cogs).toBeUndefined();
    expect(body.floor_price).toBeUndefined();
    expect(body.name).toBeUndefined();
    expect(body.low_stock_threshold).toBeUndefined();
    expect(body.is_active).toBeUndefined();
  });

  it("keeps sending the description so the column is never blanked by omission", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm({ description: "Texte existant" });
    await makeDirty();
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).description).toBe("Texte existant");
  });

  it("sends a note per pack tier", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm(
      {},
      { variants: [{ id: "v-1", label: "Pack 2", agent_note: null }] },
    );

    await userEvent.type(screen.getByLabelText("Pack 2"), "Meilleure marge");
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.variant_notes).toEqual([{ id: "v-1", agent_note: "Meilleure marge" }]);
  });

  it("surfaces an agent-content failure instead of navigating away", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });

    renderForm();
    await makeDirty();
    await userEvent.click(saveButton());

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("caps the brief at AGENT_BRIEF_MAX and counts down out loud", async () => {
    renderForm();
    const brief = screen.getByLabelText("À savoir (épinglé)") as HTMLInputElement;
    expect(brief.maxLength).toBe(280);

    const counter = screen.getByText("280 caractères restants");
    expect(counter).toHaveAttribute("aria-live", "polite");

    await userEvent.type(brief, "abc");
    expect(screen.getByText("277 caractères restants")).toBeInTheDocument();
  });
});

describe("ProductEditForm — product facts and cross-sell", () => {
  it("sends composition, usage and contraindications on the content route", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();
    await userEvent.type(screen.getByLabelText("Composition"), "Aloe vera");
    await userEvent.type(screen.getByLabelText("Mode d'emploi"), "Matin et soir");
    await userEvent.type(screen.getByLabelText("Contre-indications"), "Femmes enceintes");
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.agent_composition).toBe("Aloe vera");
    expect(body.agent_usage).toBe("Matin et soir");
    expect(body.agent_contraindications).toBe("Femmes enceintes");
  });

  it("offers only the supplied same-market alternatives and sends the choice", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm({}, { crossSellOptions: [{ id: "p-alt", name: "Pack Duo" }] });
    await userEvent.selectOptions(screen.getByLabelText("Produit alternatif"), "p-alt");
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).cross_sell_product_id).toBe("p-alt");
  });
});

describe("ProductEditForm — floor price stays with pricing", () => {
  it("sends floor_price on the super_admin PATCH, not the content route", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();
    await userEvent.type(screen.getByLabelText("Prix plancher"), "39");
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).floor_price).toBe(39);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).floor_price).toBeUndefined();
  });

  it("is not offered to a market manager", () => {
    renderForm({}, { canManageCosts: false });
    expect(screen.queryByLabelText("Prix plancher")).not.toBeInTheDocument();
  });
});

describe("ProductEditForm — validation gates the network", () => {
  it("refuses to save a blank name and never opens a request", async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText(/Nom du produit/));
    await userEvent.click(saveButton());

    expect(await screen.findByText("Le nom est obligatoire.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses an unparseable COGS", async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText(/COGS unitaire/));
    await userEvent.click(saveButton());

    expect(await screen.findByText("COGS unitaire invalide.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("ProductEditForm — market manager (content only)", () => {
  it("hides costs, stock and identity fields", () => {
    renderForm({}, { canManageCosts: false });

    expect(screen.queryByLabelText(/COGS unitaire/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Seuil stock bas/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Nom du produit/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/SKU/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("product-image-input")).not.toBeInTheDocument();
    // …but the agent sheet is theirs to write.
    expect(screen.getByLabelText("À savoir (épinglé)")).toBeInTheDocument();
    expect(screen.getByLabelText("Contre-indications")).toBeInTheDocument();
  });

  it("saves only through the agent-content route", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    renderForm({}, { canManageCosts: false });
    await makeDirty();
    await userEvent.click(saveButton());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch.mock.calls[0][0]).toBe("/api/products/p-1/agent-content");
    expect(mockPush).toHaveBeenCalledWith("/fr/products/p-1");
  });

  it("only navigates the sections it is allowed to write", () => {
    renderForm({}, { canManageCosts: false });
    const nav = screen.getByRole("navigation", { name: "Sections du formulaire" });

    expect(within(nav).getByRole("link", { name: /Fiche agent/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Composition et utilisation/ })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Identité/ })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Modèle de coûts/ })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Inventaire et statut/ })).not.toBeInTheDocument();
  });
});

/* ════════════════ REFONTE — chrome de la maquette (écran 3) ════════════════ */

describe("ProductEditForm — section navigation", () => {
  it("anchors to every mounted section without hiding any of them", () => {
    renderForm();
    const nav = screen.getByRole("navigation", { name: "Sections du formulaire" });
    const links = within(nav).getAllByRole("link");

    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#product-edit-identity",
      "#product-edit-agent-sheet",
      "#product-edit-composition",
      "#product-edit-cost-model",
      "#product-edit-stock-status",
    ]);

    // Anchors, not tabs: a long form must never hide a required field.
    for (const href of links.map((a) => a.getAttribute("href") ?? "")) {
      expect(document.querySelector(href)).toBeInTheDocument();
    }
    expect(within(nav).queryAllByRole("tab")).toHaveLength(0);
    expect(links[0]).toHaveAttribute("aria-current", "true");
  });

  it("labels every section with the role required to write it", () => {
    renderForm();
    const identity = document.getElementById("product-edit-identity") as HTMLElement;
    const sheet = document.getElementById("product-edit-agent-sheet") as HTMLElement;

    expect(within(identity).getByText("Super admin")).toBeInTheDocument();
    expect(within(sheet).getByText("Manager du marché")).toBeInTheDocument();
    expect(within(identity).getByTitle("Rôle requis : Super admin")).toBeInTheDocument();
  });
});

describe("ProductEditForm — save bar", () => {
  it("stays disabled and quiet until something actually changes", async () => {
    renderForm();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Aucune modification en attente")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Notes internes"), "a");

    expect(saveButton()).toBeEnabled();
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    expect(screen.queryByText("Aucune modification en attente")).not.toBeInTheDocument();
  });

  it("wakes up when the active switch is toggled", async () => {
    renderForm();
    expect(saveButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("switch", { name: /Produit actif/ }));
    expect(saveButton()).toBeEnabled();
  });
});

describe("ProductEditForm — active switch", () => {
  it("is a keyboard-operable switch that reports its state", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "p-1" } }) })
      .mockResolvedValueOnce(okResponse());

    renderForm();
    const sw = screen.getByRole("switch", { name: /Produit actif/ });
    expect(sw).toHaveAttribute("aria-checked", "true");

    sw.focus();
    await userEvent.keyboard("{Enter}");
    expect(sw).toHaveAttribute("aria-checked", "false");

    await userEvent.click(saveButton());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).is_active).toBe(false);
  });
});

describe("ProductEditForm — live unit margin", () => {
  it("recomputes on every keystroke and deducts the server-supplied delivery fee", async () => {
    renderForm(
      { default_price: 129, unit_cogs: 24.998, packing_cost: 0, confirmation_processing_cost: 0 },
      { avgDeliveryFee: 10 },
    );

    const card = screen.getByRole("group", { name: "Marge unitaire — en direct" });
    expect(within(card).getByText("− Livraison (moy. réelle)")).toBeInTheDocument();
    // 129 − 24,998 − 0 − 0 − 10
    expect(within(card).getByText(/94,002/)).toBeInTheDocument();
    expect(within(card).getByText(/72,9\s*%/)).toBeInTheDocument();

    const price = screen.getByLabelText("Prix de vente (optionnel)");
    await userEvent.clear(price);
    await userEvent.type(price, "139");

    expect(within(card).getByText(/104,002/)).toBeInTheDocument();
  });

  it("hides the delivery line rather than inventing a figure", () => {
    renderForm({ default_price: 129, unit_cogs: 24.998, packing_cost: 0 });

    const card = screen.getByRole("group", { name: "Marge unitaire — en direct" });
    expect(within(card).queryByText("− Livraison (moy. réelle)")).not.toBeInTheDocument();
    expect(
      within(card).getByText(
        "Frais de livraison moyens indisponibles — cette marge ne les déduit pas.",
      ),
    ).toBeInTheDocument();
    // 129 − 24,998, delivery simply not deducted.
    expect(within(card).getByText(/104,002/)).toBeInTheDocument();
  });

  it("renders the currency symbol only when the caller supplies one", () => {
    const { unmount } = renderForm({ default_price: 129, unit_cogs: 24.998, packing_cost: 0 });
    const card = screen.getByRole("group", { name: "Marge unitaire — en direct" });
    expect(within(card).getByText(/104,002/).textContent).not.toMatch(/د\.ل/);
    unmount();

    renderForm(
      { default_price: 129, unit_cogs: 24.998, packing_cost: 0 },
      { currencySymbol: "د.ل" },
    );
    const card2 = screen.getByRole("group", { name: "Marge unitaire — en direct" });
    expect(within(card2).getByText(/104,002/).textContent).toMatch(/د\.ل/);
  });

  it("is not shown to a market manager, who sees no cost figure at all", () => {
    renderForm({ default_price: 129 }, { canManageCosts: false, avgDeliveryFee: 10 });
    expect(
      screen.queryByRole("group", { name: "Marge unitaire — en direct" }),
    ).not.toBeInTheDocument();
  });
});

describe("ProductEditForm — agent preview", () => {
  it("mirrors the brief, its tone and the notes as the agent will read them", async () => {
    renderForm();
    const preview = screen.getByRole("group", { name: "Aperçu agent" });

    expect(within(preview).getByText("Brief vide — l'agent ne verra rien ici")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("À savoir (épinglé)"), "Livraison 48 h");
    expect(within(preview).getByText("Livraison 48 h")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Importance"), "critical");
    expect(within(preview).getByTestId("agent-brief-preview")).toHaveAttribute(
      "data-tone",
      "critical",
    );

    await userEvent.type(screen.getByLabelText("Notes internes"), "Ne pas promettre le samedi");
    expect(within(preview).getByText("Ne pas promettre le samedi")).toBeInTheDocument();
  });
});

describe("ProductEditForm — impact card", () => {
  it("names the in-flight orders when the caller knows them", () => {
    renderForm({}, { inFlightCount: 229 });
    const impact = screen.getByRole("group", { name: "Impact" });
    expect(
      within(impact).getByText("Ce produit a 229 commande(s) en cours chez le transporteur."),
    ).toBeInTheDocument();
    expect(within(impact).getByText(/recalcule le profit net/)).toBeInTheDocument();
  });

  it("omits the count rather than guessing it", () => {
    renderForm();
    const impact = screen.getByRole("group", { name: "Impact" });
    expect(within(impact).queryByText(/commande\(s\) en cours/)).not.toBeInTheDocument();
  });
});

describe("ProductEditForm — read-only stock", () => {
  it("shows current stock disabled, and only when it was supplied", () => {
    const { unmount } = renderForm({}, { currentStock: 216 });
    const stock = screen.getByLabelText("Stock actuel") as HTMLInputElement;
    expect(stock).toBeDisabled();
    expect(stock.value).toBe("216");
    unmount();

    renderForm();
    expect(screen.queryByLabelText("Stock actuel")).not.toBeInTheDocument();
  });
});
