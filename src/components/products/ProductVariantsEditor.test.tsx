import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ProductVariantsEditor } from "./ProductVariantsEditor";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

const t = frMessages.products.editV2.variantsEditor;

const GRAND = {
  id: "v-grand",
  kind: "attribute" as const,
  label: "Grand",
  sku: "DOU-G",
  quantity: 1,
  unit_cogs: 22,
  display_price: 149,
  current_stock: 60,
  damaged_return_count: 0,
  is_active: true,
};

const PACK2 = {
  id: "v-pack2",
  kind: "pack" as const,
  label: "Pack 2",
  sku: null,
  quantity: 2,
  unit_cogs: 0,
  display_price: 239,
  current_stock: 0,
  damaged_return_count: 0,
  is_active: true,
};

function renderEditor(
  props: Partial<React.ComponentProps<typeof ProductVariantsEditor>> = {},
  messages: typeof frMessages | typeof arMessages = frMessages,
  locale = "fr",
) {
  const defaults: React.ComponentProps<typeof ProductVariantsEditor> = {
    productId: "p-1",
    variants: [GRAND, PACK2],
    currencySymbol: "DT",
    onChanged: vi.fn(),
  };
  return {
    ...render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ProductVariantsEditor {...defaults} {...props} />
      </NextIntlClientProvider>,
    ),
    props: { ...defaults, ...props },
  };
}

/** Une ligne de variante — un groupe accessible nommé par son libellé. */
function row(label: string) {
  return screen.getByRole("group", { name: label });
}
/** Le formulaire de création ouvert, quel que soit l'axe. */
function draftRow() {
  return screen.getByRole("group", { name: new RegExp(`${t.addAttribute}|${t.addPack}`) });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function okFetch(body: unknown = { data: { id: "v-new" } }) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

/*
 * LES DEUX AXES DOIVENT SE LIRE D'UN COUP D'ŒIL.
 *
 * Le catalogue porte aujourd'hui la même doudoune en trois produits séparés
 * parce qu'aucun écran ne permettait de créer une taille. Mélanger tailles et
 * paliers dans une seule liste ramènerait la même confusion : une taille
 * s'empile en rayon, un palier non.
 */
describe("ProductVariantsEditor — les deux axes, séparés", () => {
  test("groupe les tailles et les paliers sous deux en-têtes", () => {
    renderEditor();
    expect(screen.getByText(t.axis.attribute)).toBeInTheDocument();
    expect(screen.getByText(t.axis.pack)).toBeInTheDocument();
  });

  test("affiche le stock d'une taille, et pas celui d'un palier", () => {
    renderEditor();
    expect(within(row("Grand")).getByText("60")).toBeInTheDocument();
    // Un palier ne porte pas de stock : la colonne n'existe pas sur sa ligne.
    expect(within(row("Pack 2")).queryByText(t.fields.stock)).toBeNull();
  });

  /*
   * Le stock a exactement cinq chemins, tous passant par le registre. Un champ
   * modifiable ici en ouvrirait un sixième, sans ligne pour l'expliquer — et
   * `inventory_log` est en écriture seule, donc l'écart serait définitif.
   */
  test("le stock n'est jamais un champ de saisie", () => {
    renderEditor();
    // Pas de champ étiqueté « Stock » : le nombre est affiché, jamais saisi.
    expect(within(row("Grand")).queryByLabelText(t.fields.stock)).toBeNull();
    expect(within(row("Grand")).getByText("60")).toBeInTheDocument();
    expect(screen.getByText(t.stockReadOnly)).toBeInTheDocument();
  });

  test("sans variante, le produit se vend tel quel", () => {
    renderEditor({ variants: [] });
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });
});

describe("ProductVariantsEditor — créer", () => {
  test("crée une taille avec kind='attribute'", async () => {
    const user = userEvent.setup();
    okFetch();
    const onChanged = vi.fn();
    renderEditor({ onChanged });

    await user.click(screen.getByRole("button", { name: t.addAttribute }));
    await user.type(within(draftRow()).getByLabelText(t.fields.label), "Moyen");
    await user.type(within(draftRow()).getByLabelText(t.fields.displayPrice), "139");
    await user.click(within(draftRow()).getByRole("button", { name: t.actions.save }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/products/p-1/variants");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent.kind).toBe("attribute");
    expect(sent.label).toBe("Moyen");
    expect(sent.display_price).toBe(139);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test("crée un palier avec sa quantité", async () => {
    const user = userEvent.setup();
    okFetch();
    renderEditor();

    await user.click(screen.getByRole("button", { name: t.addPack }));
    await user.type(within(draftRow()).getByLabelText(t.fields.label), "Pack 3");
    // Le formulaire de palier s'ouvre pré-rempli à 2 (le palier le plus courant),
    // donc on efface avant de saisir.
    const qty = within(draftRow()).getByLabelText(t.fields.quantity);
    await user.clear(qty);
    await user.type(qty, "3");
    await user.type(within(draftRow()).getByLabelText(t.fields.displayPrice), "339");
    await user.click(within(draftRow()).getByRole("button", { name: t.actions.save }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const sent = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(sent.kind).toBe("pack");
    expect(sent.quantity).toBe(3);
  });

  // Un formulaire de taille ne demande pas d'unités par palier : la question
  // n'a pas de sens, et y répondre « 2 » créerait une taille qui déduit double.
  test("le formulaire d'une taille ne demande pas de quantité", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: t.addAttribute }));
    expect(within(draftRow()).queryByLabelText(t.fields.quantity)).toBeNull();
  });

  test("refuse d'envoyer sans nom", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: t.addAttribute }));
    await user.type(within(draftRow()).getByLabelText(t.fields.displayPrice), "139");
    await user.click(within(draftRow()).getByRole("button", { name: t.actions.save }));

    expect(screen.getByText(t.errors.labelRequired)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("remonte le message du serveur plutôt qu'un message générique", async () => {
    const user = userEvent.setup();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "SKU already in use" }),
    });
    renderEditor();

    await user.click(screen.getByRole("button", { name: t.addAttribute }));
    await user.type(within(draftRow()).getByLabelText(t.fields.label), "Moyen");
    await user.type(within(draftRow()).getByLabelText(t.fields.displayPrice), "139");
    await user.click(within(draftRow()).getByRole("button", { name: t.actions.save }));

    expect(await screen.findByText("SKU already in use")).toBeInTheDocument();
  });
});

describe("ProductVariantsEditor — modifier et supprimer", () => {
  test("enregistre une modification en PATCH sur la variante", async () => {
    const user = userEvent.setup();
    okFetch({ data: { id: "v-grand" } });
    renderEditor();

    const cogs = within(row("Grand")).getByLabelText(t.fields.unitCogs);
    await user.clear(cogs);
    await user.type(cogs, "25");
    await user.click(within(row("Grand")).getByRole("button", { name: t.actions.save }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/products/p-1/variants/v-grand");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string).unit_cogs).toBe(25);
  });

  /*
   * Une suppression peut se transformer en retrait : si une commande s'y
   * réfère, le serveur désactive au lieu d'effacer, pour que l'historique
   * reste lisible. L'écran doit le DIRE, sinon l'utilisateur croit avoir
   * supprimé et la variante réapparaît, grisée, sans explication.
   */
  test("dit quand le serveur a retiré au lieu de supprimer", async () => {
    const user = userEvent.setup();
    okFetch({ deleted: false, retired: true });
    renderEditor();

    await user.click(within(row("Grand")).getByRole("button", { name: t.actions.delete }));
    await user.click(screen.getByRole("button", { name: t.actions.confirmDelete }));

    expect(await screen.findByText(t.retired.done)).toBeInTheDocument();
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/products/p-1/variants/v-grand");
    expect(init.method).toBe("DELETE");
  });

  test("une suppression demande confirmation avant d'appeler le serveur", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(within(row("Grand")).getByRole("button", { name: t.actions.delete }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t.actions.confirmDelete })).toBeInTheDocument();
  });

  test("marque les variantes retirées", () => {
    renderEditor({ variants: [{ ...GRAND, is_active: false }] });
    expect(screen.getByText(t.retired.badge)).toBeInTheDocument();
  });
});

/*
 * L'arabe est une langue RTL : les libellés doivent venir des messages, jamais
 * du code. Un seul mot en dur ici, et la fiche produit libyenne reste en
 * français au milieu d'une page miroir.
 */
describe("ProductVariantsEditor — arabe", () => {
  test("rend les libellés arabes, sans chaîne française résiduelle", () => {
    renderEditor({}, arMessages, "ar");
    const ar = arMessages.products.editV2.variantsEditor;
    expect(screen.getByText(ar.axis.attribute)).toBeInTheDocument();
    expect(screen.getByText(ar.axis.pack)).toBeInTheDocument();
    expect(screen.queryByText(t.axis.attribute)).toBeNull();
  });
});
