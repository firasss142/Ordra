/**
 * « En route » — les unités commandées qui ne sont pas encore sur l'étagère.
 *
 * CE CHIFFRE EST SUSPENDU, ET C'EST UNE CONSÉQUENCE DU MODÈLE.
 *
 * Sous le modèle de l'ARRIVAGE, le stock entre au moment où le carton est au
 * sol. Un groupe `open` porte donc des unités DÉJÀ comptées dans
 * `products.current_stock` — les compter ici les compterait deux fois, et
 * `reorder_by_date` soustrairait du stock qui est sur l'étagère. Un groupe
 * `settled` encore moins.
 *
 * Autrement dit : il n'y a plus rien « en route » entre le quai et le stock,
 * parce que ce trajet a disparu. Ce qui reste vraiment en transit, c'est ce qui
 * est COMMANDÉ et pas encore arrivé — et ça demande des bons de commande, qui
 * sont l'étape 6 du plan.
 *
 * `plans/stock-page-radical-redesign.md` appelait ce chiffre « la seule chose
 * vraiment non calculable ». Il le redevient, temporairement, et le dire est
 * plus honnête que de laisser l'ancienne définition gonfler la couverture.
 *
 * `null` ET JAMAIS `0` : la Map reste vide, pour que l'écran rende « — » et non
 * un zéro rassurant.
 */

export interface IncomingLine {
  product_id: string;
  expected_qty: number | null;
  received_qty: number | null;
}

export interface IncomingReception {
  status: string;
  expected_at: string | null;
  lines: IncomingLine[];
}

/**
 * Combien d'unités sont en route par produit.
 *
 * Vide tant que les bons de commande n'existent pas. La signature est conservée
 * pour que l'étape 6 n'ait qu'à la rebrancher sur `purchase_orders` — les
 * appelants, eux, gèrent déjà l'absence de valeur.
 */
export function incomingByProduct(
  _receptions: IncomingReception[],
  _now: Date = new Date(),
): Map<string, number> {
  return new Map<string, number>();
}
