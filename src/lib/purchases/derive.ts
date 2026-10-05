/**
 * Ce qu'on doit aux fournisseurs.
 *
 * LE DÛ EST LA FACTURE, PAS LE COÛT DE REVIENT. `receptions.invoice_total` est
 * ce que le fournisseur réclame ; le coût de revient y ajoute le transport et la
 * douane, qui sont dus à d'autres. Les additionner ferait payer deux fois dans
 * la tête du lecteur, donc rien d'autre que la facture n'entre dans ce calcul.
 *
 * UNE FACTURE NON CHIFFRÉE VAUT `null`, PAS `0`. Une réception dont le bureau
 * n'a pas encore saisi la facture est une dette dont on ignore le montant —
 * l'afficher à zéro dirait « rien à payer », ce qui est faux et rassurant.
 * C'est la même règle que « non annoncé » sur les quantités.
 */

export type PayableState = "paid" | "due" | "overdue" | "unknown";

export interface PayableInput {
  /** Ce que réclame le fournisseur. `null` tant que la réception n'est pas soldée. */
  invoiceTotal: number | null;
  /** Somme des versements déjà enregistrés. */
  paid: number;
  /** Échéance convenue, ISO `YYYY-MM-DD`. `null` quand personne ne l'a posée. */
  dueAt: string | null;
  /**
   * Ce qu'un litige retire de cette facture — on ne le paiera pas.
   *
   * `invoice_total` porte ce que le fournisseur a ÉCRIT ; ce qu'on refuse de
   * payer vit dans `supplier_claims`. Sans cette soustraction l'échéancier
   * réclamerait des unités arrivées cassées, et continuerait de les réclamer
   * APRÈS que le fournisseur a émis son avoir.
   *
   * Absent = rien de retenu. Voir src/lib/purchases/claims.ts.
   */
  withheld?: number;
}

export interface PayableRow extends PayableInput {
  receptionId: string;
  supplierId: string | null;
}

export interface Payable {
  /** `null` quand la facture n'est pas chiffrée. Jamais négatif. */
  balance: number | null;
  state: PayableState;
  /** Renseigné seulement quand l'état est `overdue`. */
  daysLate: number | null;
}

/** Les montants sont en millièmes (LYD/TND à 3 décimales) : le bruit flottant s'arrête là. */
const MONEY_EPSILON = 0.0005;
const DAY_MS = 86_400_000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function payable(input: PayableInput, today: Date): Payable {
  if (input.invoiceTotal === null) {
    return { balance: null, state: "unknown", daysLate: null };
  }

  const rest = input.invoiceTotal - input.paid - (input.withheld ?? 0);
  // Un virement en trop est une créance SUR le fournisseur, pas une dette
  // négative. On l'écrase à zéro plutôt que de l'inventer à l'envers ici.
  const balance = rest <= MONEY_EPSILON ? 0 : rest;
  if (balance === 0) return { balance: 0, state: "paid", daysLate: null };

  const due = input.dueAt ? parseDay(input.dueAt) : null;
  // On doit, mais personne n'a posé d'échéance : ce n'est pas « en retard »,
  // c'est « sans date ». Inventer un retard ferait crier une ligne saine.
  if (due === null) return { balance, state: "due", daysLate: null };

  const late = Math.round((utcDay(today) - due) / DAY_MS);
  if (late > 0) return { balance, state: "overdue", daysLate: late };
  return { balance, state: "due", daysLate: null };
}
