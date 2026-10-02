"use client";

import { useTranslations } from "next-intl";
import { WH_TONE, type WhTone } from "@/components/warehouse/console/tokens";

/**
 * La pastille de statut d'une réception.
 *
 * LE LIBELLÉ EST TOUJOURS LÀ. Dans la palette de l'entrepôt, vert et turquoise
 * puis rouge et ambre sont à ΔE ≈ 10 et ne peuvent pas être écartés davantage :
 * la couleur n'est donc jamais le seul canal, et l'entrepôt se lit parfois en
 * plein soleil sur un quai.
 */

const TONE: Record<string, WhTone> = {
  draft: "muted",
  submitted: "warn",
  posted: "ok",
  cancelled: "muted",
  reversed: "bad",
};

/*
 * UN SEUL MOT POUR UN SEUL ÉTAT. `draft` se dit « Attendue », comme le filtre
 * qui le retourne. Il s'est appelé « Brouillon » un temps, à quinze centimètres
 * d'un segment nommé « Attendues » qui ne montrait que lui : deux noms pour le
 * même fait dans le même écran, et personne ne peut deviner qu'ils sont égaux.
 */
const LABEL: Record<string, string> = {
  draft: "statusExpected",
  submitted: "statusSubmitted",
  posted: "statusPosted",
  cancelled: "statusCancelled",
  reversed: "statusReversed",
};

export function ReceptionStatusChip({ status }: { status: string }) {
  const t = useTranslations("warehouse.receptions");
  const tone = WH_TONE[TONE[status] ?? "muted"];
  const label = LABEL[status] ? t(LABEL[status]) : status;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-0.5 text-[12px] font-semibold ${tone.pill}`}
    >
      <span className={`h-[7px] w-[7px] flex-none rounded-[2px] ${tone.fill}`} aria-hidden />
      {label}
    </span>
  );
}

/**
 * L'état de paiement, déduit et non stocké.
 *
 * `null` veut dire « ce lecteur n'a pas le droit de voir l'argent » — la
 * pastille disparaît alors complètement plutôt que d'afficher un état vide.
 *
 * UN POURCENTAGE, PAS UN MONTANT. « acompte 40 % » tient dans une colonne de
 * liste ; « reste 11 232,000 LYD » n'y tient pas et se ferait tronquer. Le
 * montant exact est dans la feuille, où il y a la place de le dire au millième.
 */
export function PaymentChip({
  state,
  percent,
}: {
  state: string | null;
  /** La part versée, pour « acompte 40 % ». `null` → la pastille reste générique. */
  percent?: number | null;
}) {
  const t = useTranslations("warehouse.receptions");
  if (!state) return null;
  /*
   * « sans objet » est un libellé dont tout le contenu est « cette colonne ne me
   * concerne pas ». Une réception attendue n'a pas de valeur reçue, donc pas de
   * dette : il n'y a rien à dire, et on ne remplit pas une case pour qu'elle ne
   * soit pas vide. Même règle que `null` plutôt que `0`.
   */
  if (state === "not_applicable") return null;

  const tone =
    state === "paid"
      ? WH_TONE.ok
      : state === "partial"
        ? WH_TONE.warn
        : state === "unpaid"
          ? WH_TONE.bad
          : WH_TONE.muted;

  const label =
    state === "paid"
      ? t("payPaid")
      : state === "partial"
        ? percent !== null && percent !== undefined
          ? t("payPartialPercent", { percent })
          : t("payPartial")
        : t("payUnpaid");

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11.5px] font-semibold ${tone.pill}`}
    >
      {label}
    </span>
  );
}
