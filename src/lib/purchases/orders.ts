/**
 * LES BONS DE COMMANDE — ce qui est commandé, ce qui manque, à qui se fier.
 *
 * Pur : aucun import Supabase, aucun `next/server`. Les écrans l'importent
 * librement, et toute la dérivation est testable sans base.
 *
 * TROIS RÈGLES D'HONNÊTETÉ TRAVERSENT CE FICHIER :
 *   · `null` et jamais `0` quand on ne sait pas — un engagement sans prix
 *     annoncé n'est pas un engagement de zéro dinar ;
 *   · pas de retard contre une date que personne n'a posée ;
 *   · pas de note de fournisseur sur une commande encore ouverte, parce qu'une
 *     livraison courte est le cas NORMAL tant que le camion roule.
 */

export type PurchaseOrderStatus = "open" | "closed" | "cancelled";

export interface PurchaseOrderLineRow {
  id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_label: string | null;
  ordered_qty: number;
  /** Le prix ANNONCÉ. NULL quand on a commandé sans prix convenu. */
  unit_cost: number | null;
  /** Somme des rattachements du quai — déjà agrégée par la vue. */
  received_qty: number;
  /** Le premier carton rattaché à cette ligne. NULL si rien n'est arrivé. */
  first_received_at: string | null;
}

export interface PurchaseOrderRow {
  id: string;
  reference: string;
  market_id: string;
  warehouse_id: string;
  warehouse_name: string | null;
  supplier_id: string;
  supplier_name: string | null;
  status: PurchaseOrderStatus;
  wanted_by: string | null;
  ordered_at: string;
  ordered_by_name: string | null;
  closed_at: string | null;
  close_reason: string | null;
  note: string | null;
  lines: PurchaseOrderLineRow[];
}

export interface ProjectedPurchaseOrderLine extends PurchaseOrderLineRow {
  /** Ce qu'on attend encore. Jamais négatif : voir `over_received_qty`. */
  outstanding_qty: number;
  /** Ce qui est arrivé EN PLUS. Un fait, pas une erreur à forcer dans une case. */
  over_received_qty: number;
}

export interface ProjectedPurchaseOrder extends PurchaseOrderRow {
  lines: ProjectedPurchaseOrderLine[];
  ordered_units: number;
  received_units: number;
  outstanding_units: number;
  over_received_units: number;
  /** Σ qté × prix annoncé. NULL dès qu'une ligne n'a pas de prix. */
  committed_value: number | null;
  is_late: boolean;
  days_late: number | null;
}

const DAY_MS = 86_400_000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function projectPurchaseOrder(
  row: PurchaseOrderRow,
  today: Date,
): ProjectedPurchaseOrder {
  const lines: ProjectedPurchaseOrderLine[] = row.lines.map((l) => ({
    ...l,
    outstanding_qty: Math.max(l.ordered_qty - l.received_qty, 0),
    over_received_qty: Math.max(l.received_qty - l.ordered_qty, 0),
  }));

  let ordered = 0;
  let received = 0;
  let outstanding = 0;
  let over = 0;
  let value: number | null = 0;
  for (const l of lines) {
    ordered += l.ordered_qty;
    received += l.received_qty;
    outstanding += l.outstanding_qty;
    over += l.over_received_qty;
    // Une seule ligne sans prix rend le total du document inconnu. Additionner
    // les autres donnerait un chiffre plus petit que la vérité, et personne ne
    // saurait de combien.
    if (value !== null) {
      value = l.unit_cost === null ? null : value + l.ordered_qty * l.unit_cost;
    }
  }

  // UNE COMMANDE CLÔTURÉE N'EST PLUS EN RETARD. Elle l'a peut-être été ; ce
  // n'est plus une chose sur laquelle agir, et la liste des retards est une
  // liste d'actions.
  const due = row.status === "open" && row.wanted_by ? parseDay(row.wanted_by) : null;
  const late = due === null ? null : Math.round((utcDay(today) - due) / DAY_MS);

  return {
    ...row,
    lines,
    ordered_units: ordered,
    received_units: received,
    outstanding_units: outstanding,
    over_received_units: over,
    committed_value: value,
    is_late: late !== null && late > 0,
    days_late: late !== null && late > 0 ? late : null,
  };
}

/**
 * « EN ROUTE », par produit — la seule définition qui ne compte pas deux fois.
 *
 * Sous le modèle de l'arrivage, le stock entre quand le carton touche le sol :
 * ce qui est vraiment en transit est donc ce qui est COMMANDÉ et pas encore
 * arrivé, et rien d'autre. Une commande clôturée ou annulée n'est plus attendue
 * — la compter gonflerait la couverture pour toujours, exactement le défaut que
 * l'ancien `expected_qty` aurait eu si quelqu'un l'avait jamais rempli.
 *
 * Le grain interne est (produit, taille), parce que c'est là que vit le stock ;
 * la Map est agrégée au produit, parce que c'est le grain de la ligne Niveaux.
 *
 * Un produit entièrement servi est ABSENT de la Map, pas à `0` : l'écran rend
 * « — » plutôt qu'un zéro rassurant.
 */
export function outstandingByProduct(
  orders: PurchaseOrderRow[],
  today: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of orders) {
    if (row.status !== "open") continue;
    for (const l of projectPurchaseOrder(row, today).lines) {
      if (l.outstanding_qty <= 0) continue;
      out.set(l.product_id, (out.get(l.product_id) ?? 0) + l.outstanding_qty);
    }
  }
  return out;
}

export interface SupplierReliability {
  /** reçu / commandé sur les commandes terminées. NULL sans échantillon. */
  service_rate: number | null;
  /** Combien de commandes terminées nourrissent le taux. */
  sample_orders: number;
  /** Médiane des jours entre la commande et son premier carton. NULL sans aucun. */
  lead_time_days: number | null;
}

/**
 * À QUI PUIS-JE ME FIER — deux chiffres, et le silence quand il n'y a rien.
 *
 * On ne note que les commandes CLÔTURÉES : tant qu'une commande court, le reste
 * peut encore arriver, et la juger maintenant condamnerait tout fournisseur
 * dont le camion roule. Une commande ANNULÉE n'entre pas non plus — rien n'en
 * est arrivé, donc elle ne dit rien sur la capacité à servir, seulement sur la
 * nôtre à changer d'avis.
 *
 * Le délai est une MÉDIANE et non une moyenne : un seul conteneur bloqué trois
 * mois en douane déplacerait une moyenne de plusieurs semaines et ferait
 * commander trop tôt, pour toujours.
 */
export function supplierReliability(
  orders: PurchaseOrderRow[],
  today: Date,
): SupplierReliability {
  let ordered = 0;
  let received = 0;
  let sample = 0;
  const leads: number[] = [];

  for (const row of orders) {
    if (row.status !== "closed") continue;
    sample += 1;
    const p = projectPurchaseOrder(row, today);
    ordered += p.ordered_units;
    // Plafonné à la commande : une sur-livraison ne fait pas un taux de
    // service de 107 %, elle fait une commande servie.
    received += Math.min(p.received_units, p.ordered_units);

    const firsts = row.lines
      .map((l) => l.first_received_at)
      .filter((d): d is string => d !== null)
      .sort();
    if (firsts.length > 0) {
      leads.push(Math.round((parseDay(firsts[0]) - parseDay(row.ordered_at)) / DAY_MS));
    }
  }

  let lead: number | null = null;
  if (leads.length > 0) {
    const s = [...leads].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    lead = s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  return {
    service_rate: ordered > 0 ? received / ordered : null,
    sample_orders: sample,
    lead_time_days: lead,
  };
}
