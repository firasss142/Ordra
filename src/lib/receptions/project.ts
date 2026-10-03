import type { Role } from "@/types";
import {
  canPostReception,
  canReverseReception,
  canDraftReception,
  canSeeReceptionCosts,
} from "./permissions";
import { allocateFees, feesTotal, type FeeBasis } from "./landed";
import {
  lineVariance,
  paymentState,
  receptionTotals,
  isLate,
  daysLate,
  weightedAverageCost,
  type PaymentState,
  type ReceptionStatus,
} from "./derive";

/**
 * Ce qu'une route de réception laisse sortir, selon qui demande.
 *
 * LE COÛT EST RETIRÉ, PAS MASQUÉ. Un agent d'entrepôt ne reçoit pas les
 * champs de prix : ils sont absents de l'objet, pas cachés par du CSS. En
 * production `products.unit_cogs` est accordé à `authenticated` malgré ce
 * qu'affirme la documentation (voir la note de 20260920162309), donc un agent
 * qui ouvre l'onglet réseau de son navigateur lirait les prix d'achat si on se
 * contentait de ne pas les dessiner. « Caché » n'est pas « absent ».
 *
 * L'ÉCART RESTE, LUI. Savoir qu'il manque 6 unités est le cœur du métier de
 * l'agent ; savoir qu'elles valaient 85 dinars ne l'est pas.
 */

export interface RawReceptionLine {
  id: string;
  product_id: string;
  variant_id: string | null;
  expected_qty: number | null;
  received_qty: number | null;
  damaged_qty: number | null;
  unit_cost: number | null;
  landed_unit_cost?: number | null;
  note: string | null;
  product: {
    name: string;
    sku: string | null;
    image_url: string | null;
    current_stock: number;
    unit_cogs: number;
  } | null;
  variant: { label: string; sku: string | null } | null;
}

export interface RawReception {
  id: string;
  market_id: string;
  warehouse_id: string;
  reference: string;
  supplier_name: string | null;
  supplier_ref: string | null;
  status: ReceptionStatus | string;
  expected_at: string | null;
  note: string | null;
  photo_url: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  posted_at: string | null;
  posted_by: string | null;
  reverses_reception_id: string | null;
  created_at: string;
  warehouse: { code: string; name_fr: string; name_ar: string } | null;
  submitted_by_user: { full_name: string } | null;
  posted_by_user: { full_name: string } | null;
  reception_lines: RawReceptionLine[];
  fee_basis?: string | null;
  reception_costs?: {
    id: string;
    kind: string;
    label: string | null;
    amount: number;
  }[] | null;
  reception_payments: {
    id: string;
    paid_at: string;
    amount: number;
    method: string | null;
    note: string | null;
  }[];
}

export interface ProjectedLine {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  product_sku: string | null;
  /** Pour la vignette. Pas une information de coût : un agent y a droit. */
  product_image_url: string | null;
  /**
   * Le stock actuel du produit. Pas un prix : c'est le chiffre qui dit si ce
   * carton comble un manque ou empile du dormant, et l'agent le voit déjà sur
   * l'onglet Niveaux. Il reste donc dans la projection de tous les rôles.
   */
  product_stock: number | null;
  variant_label: string | null;
  expected_qty: number | null;
  received_qty: number | null;
  damaged_qty: number;
  /** `null` dès qu'un des deux nombres manque — « non annoncé », pas 0. */
  variance: number | null;
  note: string | null;
  /** Absents pour un agent d'entrepôt. */
  unit_cost?: number | null;
  /**
   * La part des frais d'approche portée par cette ligne, et le coût de revient
   * qui en résulte. Calculés à la volée tant que la réception n'est pas validée
   * (l'écran montre ce qui va être écrit) ; relus de la base ensuite.
   */
  fee_share?: number | null;
  landed_unit_cost?: number | null;
  line_value?: number | null;
  cogs_current?: number | null;
  cogs_next?: number | null;
}

export interface ProjectedReception {
  id: string;
  reference: string;
  market_id: string;
  warehouse_id: string;
  warehouse_name: string | null;
  warehouse_name_ar: string | null;
  supplier_name: string | null;
  supplier_ref: string | null;
  status: string;
  expected_at: string | null;
  note: string | null;
  photo_url: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  posted_at: string | null;
  posted_by_name: string | null;
  reverses_reception_id: string | null;
  created_at: string;
  is_late: boolean;
  days_late: number | null;
  lines: ProjectedLine[];
  totals: {
    units: number;
    damaged: number;
    value: number | null;
    lines: number;
    /** `null` quand rien n'est annoncé — « non annoncé », pas « zéro attendu ». */
    expected: number | null;
    /** Lignes portant un nombre reçu, zéro compris. */
    countedLines: number;
  };
  /** Le critère de répartition des frais : par valeur, ou par unité. */
  fee_basis: FeeBasis;
  /** Vides pour qui n'a pas le droit de voir l'argent. */
  costs: { id: string; kind: string; label: string | null; amount: number }[];
  /** Total des frais d'approche. `null` sans droit sur l'argent. */
  fees_total: number | null;
  /**
   * Pourquoi les frais n'ont pas pu être répartis — par valeur sans aucun prix,
   * ou par unité sans rien de compté. On ne retombe PAS silencieusement sur
   * l'autre critère : un repli muet est ce qui fabrique un coût faux sans rien
   * signaler. L'écran demande de choisir, ou de saisir les prix.
   */
  fees_blocked: "no_value" | "no_units" | null;
  /**
   * Marchandises + frais : CE chiffre est le coût de revient de la réception, et
   * c'est lui qui alimente `unit_cogs`. `totals.value` reste le prix fournisseur
   * seul, qui est ce qu'on DOIT, pas ce que ça COÛTE.
   */
  landed_value: number | null;
  /** `null` pour qui n'a pas le droit de voir l'argent. */
  payments: { id: string; paid_at: string; amount: number; method: string | null; note: string | null }[];
  paid_total: number | null;
  outstanding: number | null;
  payment_state: PaymentState | null;
  can: {
    submit: boolean;
    post: boolean;
    reverse: boolean;
    pay: boolean;
    /** Rendre une déclaration à son agent. Rien n'a bougé : c'est un retour en brouillon. */
    sendBack: boolean;
  };
}

export function projectReception(
  raw: RawReception,
  role: Role,
  now: Date = new Date(),
): ProjectedReception {
  const withCosts = canSeeReceptionCosts(role);
  const isDraftish = raw.status === "draft" || raw.status === "submitted";

  const lines: ProjectedLine[] = raw.reception_lines.map((line) => {
    const base: ProjectedLine = {
      id: line.id,
      product_id: line.product_id,
      variant_id: line.variant_id,
      product_name: line.product?.name ?? "—",
      product_sku: line.product?.sku ?? null,
      product_image_url: line.product?.image_url ?? null,
      product_stock: line.product?.current_stock ?? null,
      variant_label: line.variant?.label ?? null,
      expected_qty: line.expected_qty,
      received_qty: line.received_qty,
      damaged_qty: line.damaged_qty ?? 0,
      variance: lineVariance({ expected: line.expected_qty, received: line.received_qty }),
      note: line.note,
    };

    if (!withCosts) return base;

    const received = line.received_qty ?? 0;
    const cogsCurrent = line.product?.unit_cogs ?? null;
    return {
      ...base,
      unit_cost: line.unit_cost,
      line_value: line.unit_cost !== null ? line.unit_cost * received : null,
      cogs_current: cogsCurrent,
      // Provisoire : recalculé plus bas sur le COÛT DE REVIENT, une fois les
      // frais d'approche répartis. Le prix fournisseur seul donnerait un COGS
      // systématiquement trop bas.
      cogs_next: null,
    };
  });

  const totals = receptionTotals(
    raw.reception_lines.map((l) => ({
      expected_qty: l.expected_qty,
      received_qty: l.received_qty,
      damaged_qty: l.damaged_qty,
      // Sans droit sur les coûts, la valeur ne peut pas être calculée : elle
      // sortira `null`, ce qui est la vérité pour ce lecteur.
      unit_cost: withCosts ? l.unit_cost : null,
    })),
  );

  const paid = withCosts
    ? raw.reception_payments.reduce((sum, p) => sum + Number(p.amount), 0)
    : null;

  /*
   * LES FRAIS D'APPROCHE, RÉPARTIS POUR L'ÉCRAN.
   *
   * La base refait le même calcul au moment de valider (`allocate_reception_fees`,
   * même méthode du plus grand reste) : l'écran montre donc exactement ce qui
   * sera écrit. Si l'un des deux change, l'autre doit changer avec lui.
   */
  const rawCosts = raw.reception_costs ?? [];
  const fees = withCosts ? feesTotal(rawCosts) : null;
  const basis: FeeBasis = raw.fee_basis === "units" ? "units" : "value";
  const allocation = withCosts
    ? allocateFees(
        raw.reception_lines.map((l) => ({
          id: l.id,
          receivedQty: l.received_qty,
          unitCost: l.unit_cost,
        })),
        fees ?? 0,
        basis,
      )
    : null;
  const shareByLine = new Map(
    (allocation?.allocations ?? []).map((a) => [a.lineId, a]),
  );

  if (withCosts) {
    const storedByLine = new Map(raw.reception_lines.map((l) => [l.id, l.landed_unit_cost]));
    for (const line of lines) {
      const share = shareByLine.get(line.id);
      line.fee_share = share?.share ?? 0;
      /*
       * Une réception VALIDÉE porte son coût de revient figé en base : c'est ce
       * qui a réellement nourri `unit_cogs`, et le recalculer à l'affichage
       * pourrait montrer autre chose que ce qui a été écrit. Avant la
       * validation, on montre au contraire ce qui SERA écrit.
       */
      const stored = storedByLine.get(line.id);
      line.landed_unit_cost =
        stored !== null && stored !== undefined ? Number(stored) : (share?.landedUnitCost ?? null);

      /*
       * CE QUE LA VALIDATION ÉCRIRA DANS `unit_cogs` — à partir du coût de
       * revient, jamais du seul prix fournisseur. Montrer l'arithmétique avant
       * de l'appliquer est ce qui rend la politique de coût lisible ; la
       * calculer sur `unit_cost` la rendrait lisible ET fausse.
       */
      const src = raw.reception_lines.find((r) => r.id === line.id);
      line.cogs_next = weightedAverageCost({
        stockBefore: src?.product?.current_stock ?? 0,
        cogsBefore: line.cogs_current ?? 0,
        qty: line.received_qty ?? 0,
        unitCost: line.landed_unit_cost,
      });
    }
  }

  return {
    id: raw.id,
    reference: raw.reference,
    market_id: raw.market_id,
    warehouse_id: raw.warehouse_id,
    warehouse_name: raw.warehouse?.name_fr ?? null,
    warehouse_name_ar: raw.warehouse?.name_ar ?? null,
    supplier_name: raw.supplier_name,
    supplier_ref: raw.supplier_ref,
    status: raw.status,
    expected_at: raw.expected_at,
    note: raw.note,
    photo_url: raw.photo_url,
    submitted_at: raw.submitted_at,
    submitted_by_name: raw.submitted_by_user?.full_name ?? null,
    posted_at: raw.posted_at,
    posted_by_name: raw.posted_by_user?.full_name ?? null,
    reverses_reception_id: raw.reverses_reception_id,
    created_at: raw.created_at,
    is_late: isLate({ expected_at: raw.expected_at, status: raw.status }, now),
    days_late: daysLate({ expected_at: raw.expected_at, status: raw.status }, now),
    lines,
    totals: {
      units: totals.units,
      damaged: totals.damaged,
      value: totals.value,
      lines: totals.lines,
      expected: totals.expected,
      countedLines: totals.countedLines,
    },
    fee_basis: basis,
    costs: withCosts ? rawCosts : [],
    fees_total: fees,
    fees_blocked: allocation?.blocked ?? null,
    landed_value:
      withCosts && totals.value !== null ? Number((totals.value + (fees ?? 0)).toFixed(3)) : null,
    payments: withCosts ? raw.reception_payments : [],
    paid_total: paid,
    outstanding:
      withCosts && totals.value !== null ? Math.max(totals.value - (paid ?? 0), 0) : null,
    payment_state: withCosts ? paymentState({ value: totals.value, paid: paid ?? 0 }) : null,
    can: {
      submit: canDraftReception(role) && raw.status === "draft",
      post: canPostReception(role) && isDraftish,
      reverse: canReverseReception(role) && raw.status === "posted",
      pay: canSeeReceptionCosts(role) && raw.status !== "reversed",
      /*
       * Renvoyer est le geste de celui qui VALIDE, pas de celui qui déclare :
       * sans lui, un manager qui voit une erreur n'a que deux issues, valider
       * ce qui est faux ou ne rien faire. Et sur un brouillon il n'y a personne
       * à qui le rendre.
       */
      sendBack: canPostReception(role) && raw.status === "submitted",
    },
  };
}

export function projectReceptionList(
  rows: RawReception[],
  role: Role,
  now: Date = new Date(),
): ProjectedReception[] {
  return rows.map((row) => projectReception(row, role, now));
}
