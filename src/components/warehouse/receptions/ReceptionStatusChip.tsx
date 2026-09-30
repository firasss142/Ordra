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

const LABEL: Record<string, string> = {
  draft: "statusDraft",
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
 */
export function PaymentChip({
  state,
  outstanding,
  currency,
}: {
  state: string | null;
  outstanding: number | null;
  currency: string;
}) {
  const t = useTranslations("warehouse.receptions");
  if (!state) return null;

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
        ? t("payPartial")
        : state === "unpaid"
          ? t("payUnpaid")
          : t("payNotApplicable");

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11.5px] font-semibold ${tone.pill}`}
    >
      {label}
      {state === "partial" && outstanding !== null ? (
        <span className="font-mono tabular-nums">
          {" · "}
          {outstanding.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} {currency}
        </span>
      ) : null}
    </span>
  );
}
