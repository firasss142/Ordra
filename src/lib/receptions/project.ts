import type { Role } from "@/types";
import {
  canPostReception,
  canReverseReception,
  canDraftReception,
  canSeeReceptionCosts,
} from "./permissions";
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
      // Ce que `p_adopt_costs` écrirait. Montrer l'arithmétique AVANT de
      // l'appliquer est ce qui rend la case à cocher honnête.
      cogs_next: weightedAverageCost({
        stockBefore: line.product?.current_stock ?? 0,
        cogsBefore: cogsCurrent ?? 0,
        qty: received,
        unitCost: line.unit_cost,
      }),
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
