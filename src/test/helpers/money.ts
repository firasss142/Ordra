import { formatCurrency } from "@/lib/format";

/**
 * Matcher Testing Library pour un montant formaté.
 *
 * ── POURQUOI CE HELPER EXISTE ─────────────────────────────────────────────
 * `formatCurrency` produit trois familles de caractères invisibles :
 *   • les isolats bidi LRI (U+2066) / PDI (U+2069) qui encadrent le montant,
 *   • l'espace fine insécable de groupement (U+202F) de fr-TN,
 *   • l'espace insécable (U+00A0) entre le nombre et le symbole.
 *
 * Testing Library normalise les blancs du DOM avant de comparer (`\s+` → " "),
 * mais PAS la chaîne attendue qu'on lui passe. Un `getByText(formatCurrency(x))`
 * échoue donc alors même que le texte est là : côté DOM les espaces sont devenus
 * des espaces ASCII, côté attente ils sont restés fins et insécables.
 *
 * Écrire le littéral à la main est pire encore : « ⁦15 216,599 DT⁩ » est
 * indiscernable de « 15 216,599 DT » dans un éditeur, et le premier caractère
 * de désynchronisation produit un échec illisible.
 *
 * On normalise donc LES DEUX CÔTÉS, et on ne retient que les nœuds feuilles —
 * sans ce garde, chaque ancêtre contenant le montant correspondrait aussi et
 * `getByText` lèverait « found multiple elements ».
 */
export function money(amount: number, market = "TN") {
  const expected = formatCurrency(amount, market).replace(/\s+/g, " ");
  return (_content: string, element: Element | null): boolean =>
    element !== null &&
    element.children.length === 0 &&
    (element.textContent ?? "").replace(/\s+/g, " ") === expected;
}
