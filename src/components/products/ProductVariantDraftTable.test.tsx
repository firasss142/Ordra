import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, test, expect, vi } from "vitest";
import {
  ProductVariantDraftTable,
  emptyVariantDraft,
  type VariantDraft,
} from "./ProductVariantDraftTable";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

const t = frMessages.products.create.variants;

function renderTable(
  value: VariantDraft[] = [emptyVariantDraft()],
  onChange = vi.fn(),
  messages: typeof frMessages | typeof arMessages = frMessages,
  locale = "fr",
) {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ProductVariantDraftTable value={value} onChange={onChange} currencySymbol="د.ل" />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

function rowOf(label: string) {
  return screen.getByRole("group", { name: label });
}

/*
 * Cette table n'écrit RIEN. Elle est contrôlée : le formulaire de création
 * porte l'état et n'envoie qu'une seule requête à la fin. Créer les variantes
 * une par une depuis le navigateur multiplierait les fenêtres d'échec — un
 * produit créé, deux variantes sur trois, et rien pour dire où ça s'est arrêté.
 */
describe("ProductVariantDraftTable", () => {
  test("affiche une ligne par variante, avec ses colonnes", () => {
    renderTable([{ ...emptyVariantDraft(), label: "Grand" }]);
    const row = rowOf("Grand");
    expect(within(row).getByLabelText(t.columns.label)).toBeInTheDocument();
    expect(within(row).getByLabelText(t.columns.sku)).toBeInTheDocument();
    expect(within(row).getByLabelText(t.columns.unitCogs)).toBeInTheDocument();
    expect(within(row).getByLabelText(t.columns.displayPrice)).toBeInTheDocument();
    expect(within(row).getByLabelText(t.columns.initialStock)).toBeInTheDocument();
  });

  test("saisir un nom remonte la valeur au parent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderTable([emptyVariantDraft()], onChange);

    await user.type(screen.getByLabelText(t.columns.label), "P");

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as VariantDraft[];
    expect(next[0].label).toBe("P");
  });

  test("ajouter une variante rend une ligne de plus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderTable([{ ...emptyVariantDraft(), label: "Grand" }], onChange);

    await user.click(screen.getByRole("button", { name: t.add }));

    const next = onChange.mock.calls.at(-1)?.[0] as VariantDraft[];
    expect(next).toHaveLength(2);
    expect(next[0].label).toBe("Grand");
  });

  test("retirer une variante l'enlève de la liste", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderTable(
      [
        { ...emptyVariantDraft(), label: "Petit" },
        { ...emptyVariantDraft(), label: "Grand" },
      ],
      onChange,
    );

    await user.click(within(rowOf("Petit")).getByRole("button", { name: t.remove }));

    const next = onChange.mock.calls.at(-1)?.[0] as VariantDraft[];
    expect(next).toHaveLength(1);
    expect(next[0].label).toBe("Grand");
  });

  // La dernière ligne ne se retire pas : l'interrupteur est là pour ça, et une
  // table vide avec l'interrupteur allumé ne veut rien dire.
  test("la dernière ligne ne peut pas être retirée", () => {
    renderTable([{ ...emptyVariantDraft(), label: "Grand" }]);
    expect(
      within(rowOf("Grand")).getByRole("button", { name: t.remove }),
    ).toBeDisabled();
  });

  test("le total du stock est la somme des variantes", () => {
    renderTable([
      { ...emptyVariantDraft(), label: "Petit", initial_stock: "216" },
      { ...emptyVariantDraft(), label: "Grand", initial_stock: "600" },
    ]);
    expect(screen.getByText(/816/)).toBeInTheDocument();
  });

  test("rend les libellés arabes, sans chaîne française résiduelle", () => {
    renderTable([{ ...emptyVariantDraft(), label: "كبير" }], vi.fn(), arMessages, "ar");
    const ar = arMessages.products.create.variants;
    expect(screen.getByRole("button", { name: ar.add })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.add })).toBeNull();
  });
});
