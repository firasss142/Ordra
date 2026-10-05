/**
 * LES RÉCLAMATIONS FOURNISSEUR — l'avarie devient enfin une action.
 *
 * Jusqu'ici `damaged_qty` était compté sur chaque ligne et lu par PERSONNE : une
 * donnée écrite, jamais relue, exactement le défaut que ce chantier traque. Et
 * le dialogue de soldage promettait déjà, en toutes lettres, que « le litige
 * reste visible dans Achats jusqu'à sa résolution » — sans que rien ne
 * l'enregistre. Ce module tient cette promesse.
 *
 * `invoice_total` PORTE CE QUE LE FOURNISSEUR A ÉCRIT, et le litige porte ce
 * qu'on REFUSE DE PAYER. C'est ce que dit le commentaire de la colonne depuis le
 * premier jour — « total de la facture fournisseur » — et y ranger 18 720 quand
 * le papier dit 18 890 stockerait un chiffre qui ne figure sur AUCUN document.
 * Il faudrait ensuite deviner, écran par écran, lequel des deux on lit.
 *
 * Le solde est donc `facture − versements − retenu`, et c'est le STATUT du
 * litige qui décide si le montant est retenu. Rien n'est jamais réécrit :
 * `receptions` est immuable après soldage, et n'a rien à corriger.
 */

/** `damaged` : arrivé cassé. `shortage` : facturé et jamais arrivé.
 *  `overbilled` : la facture dépasse sans que la base sache pourquoi. */
export type ClaimKind = "damaged" | "shortage" | "overbilled";

/**
 * `open` → on conteste, ce n'est pas dû.
 * `credited` → le fournisseur a émis un avoir : on ne l'a jamais dû, c'est clos.
 * `conceded` → on renonce : le montant rejoint l'ardoise.
 *
 * Trois états, trois conséquences financières distinctes. Un quatrième mot pour
 * la même conséquence (« retiré », « abandonné ») serait du bruit : deux noms
 * sous un seul effet finissent toujours par être comptés deux fois.
 */
export type ClaimStatus = "open" | "credited" | "conceded";

export interface SupplierClaim {
  id: string;
  supplierId: string;
  receptionId: string | null;
  kind: ClaimKind;
  /** Strictement positif. La base le contraint ; ce module se méfie quand même. */
  amount: number;
  /** Unités concernées. `null` pour un pur écart de prix, qui n'en a pas. */
  units: number | null;
  status: ClaimStatus;
  openedAt: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  creditRef?: string | null;
}

export interface ClaimEffect {
  /** Ce qu'on retire de la facture : on ne le paiera pas. */
  withheld: number;
  /** Ce qui est ENCORE contesté — un sous-ensemble de `withheld`. */
  disputed: number;
}

export function claimEffect(claim: SupplierClaim): ClaimEffect {
  // Un montant nul ou négatif n'est pas un litige. La base l'interdit, mais
  // fabriquer un litige de zéro dinar serait pire que d'ignorer la ligne.
  if (!(claim.amount > 0)) return { withheld: 0, disputed: 0 };
  if (claim.status === "open") return { withheld: claim.amount, disputed: claim.amount };
  // Crédité : l'avoir est arrivé, on ne le paiera jamais, et il n'y a plus de
  // bataille. Retenu pour toujours, contesté plus du tout.
  if (claim.status === "credited") return { withheld: claim.amount, disputed: 0 };
  // Concédé : on renonce, donc on le doit. Rien n'est retenu.
  return { withheld: 0, disputed: 0 };
}
