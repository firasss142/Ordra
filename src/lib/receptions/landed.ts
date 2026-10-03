/**
 * Les frais d'approche, répartis sur les lignes.
 *
 * LE PRIX DU FOURNISSEUR N'EST PAS CE QUE LA MARCHANDISE COÛTE. Transport,
 * douane et manutention sont payés pour qu'elle arrive ici. La migration de
 * réception n'en portait aucune trace — `grep` ne trouvait ni transport, ni
 * douane, ni dédouanement — donc tout COGS adopté depuis une réception était
 * SYSTÉMATIQUEMENT TROP BAS, ce qui gonfle la marge de chaque produit, le seuil
 * de rentabilité et les relevés investisseurs. Une moyenne pondérée bâtie sur un
 * coût incomplet est pire qu'une estimation périmée : elle est confiante.
 *
 * TOUT SE CALCULE EN MILLIÈMES. Le dinar libyen comme le dinar tunisien ont
 * trois décimales ; en travaillant sur des entiers on ne rencontre jamais le
 * bruit flottant, et la méthode du plus grand reste garantit que la somme des
 * parts est EXACTEMENT le total des frais. Arrondir chaque part séparément
 * perdrait un millième, et ce millième manquant rendrait le rapprochement
 * contre la facture faux pour toujours.
 */

export type FeeBasis = "value" | "units";

export interface AllocatableLine {
  id: string;
  /** `null` = pas encore comptée : rien n'est arrivé, rien ne lui est imputé. */
  receivedQty: number | null;
  /** `null` = prix inconnu. Elle ne pèse alors rien dans une répartition par valeur. */
  unitCost: number | null;
}

export interface Allocation {
  lineId: string;
  /** La part des frais portée par cette ligne, à trois décimales. */
  share: number;
  /** `unitCost + share / qty`. `null` si le prix ou la quantité manque. */
  landedUnitCost: number | null;
}

export interface AllocationResult {
  basis: FeeBasis;
  total: number;
  allocations: Allocation[];
  /**
   * Pourquoi rien n'a pu être réparti. On ne retombe PAS silencieusement sur
   * l'autre critère : un repli muet est exactement ce qui fabrique un coût faux
   * sans rien signaler. L'écran demande de choisir, ou de saisir un prix.
   */
  blocked: "no_value" | "no_units" | null;
}

const SCALE = 1000;

function toMillimes(n: number): number {
  return Math.round(n * SCALE);
}

/**
 * Répartit `totalMillimes` selon `weights`, à l'entier près et sans perte.
 *
 * Chaque part reçoit sa valeur plancher, puis les quelques millièmes restants
 * vont aux plus grands restes. La somme vaut donc toujours le total exact.
 */
function largestRemainder(weights: number[], totalMillimes: number): number[] {
  const totalWeight = weights.reduce((a, w) => a + w, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalMillimes * w) / totalWeight);
  const floors = exact.map((x) => Math.floor(x));
  let deficit = totalMillimes - floors.reduce((a, x) => a + x, 0);

  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);

  for (let k = 0; deficit > 0 && k < order.length; k += 1, deficit -= 1) {
    floors[order[k].i] += 1;
  }
  return floors;
}

export function allocateFees(
  lines: AllocatableLine[],
  feesTotal: number,
  basis: FeeBasis,
): AllocationResult {
  // Une ligne non comptée n'a rien reçu : elle ne porte aucun frais.
  const weightOf = (l: AllocatableLine): number => {
    const qty = l.receivedQty ?? 0;
    if (qty <= 0) return 0;
    if (basis === "units") return toMillimes(qty);
    // Par valeur : une ligne sans prix ne pèse rien, parce qu'elle n'a pas de
    // valeur — pas parce qu'elle vaut zéro.
    return l.unitCost === null ? 0 : toMillimes(qty * l.unitCost);
  };

  const weights = lines.map(weightOf);
  const totalWeight = weights.reduce((a, w) => a + w, 0);
  const totalMillimes = toMillimes(feesTotal);

  const landedOf = (l: AllocatableLine, share: number): number | null => {
    const qty = l.receivedQty ?? 0;
    if (qty <= 0 || l.unitCost === null) return null;
    return Number((l.unitCost + share / qty).toFixed(3));
  };

  // Aucun frais à répartir : des parts nulles, et surtout pas un blocage. Le
  // coût de revient est alors exactement le prix du fournisseur.
  if (totalMillimes === 0) {
    return {
      basis,
      total: 0,
      blocked: null,
      allocations: lines.map((l) => ({
        lineId: l.id,
        share: 0,
        landedUnitCost: landedOf(l, 0),
      })),
    };
  }

  if (totalWeight <= 0) {
    return {
      basis,
      total: feesTotal,
      allocations: [],
      blocked: basis === "value" ? "no_value" : "no_units",
    };
  }

  const parts = largestRemainder(weights, totalMillimes);

  return {
    basis,
    total: feesTotal,
    blocked: null,
    allocations: lines.map((l, i) => {
      const share = parts[i] / SCALE;
      return { lineId: l.id, share, landedUnitCost: landedOf(l, share) };
    }),
  };
}

/** Le total des frais saisis sur une réception. */
export function feesTotal(costs: { amount: number | null }[]): number {
  return costs.reduce((a, c) => a + (c.amount ?? 0), 0);
}
