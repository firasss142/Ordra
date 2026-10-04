"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, AlertCircle, Clock, Inbox, ChevronRight } from "lucide-react";
import type { Role } from "@/types";
import type { ProjectedReception } from "@/lib/receptions/project";
import { useReceptions } from "@/hooks/useReceptions";
import { headlineQuantity, paidPercent } from "@/lib/receptions/derive";
import { WH_CARD, WH_LABEL, WH_BTN_PRIMARY, WH_STRIPE } from "@/components/warehouse/console/tokens";
import { ReceptionStatusChip, PaymentChip } from "./ReceptionStatusChip";
import { ReceptionSheet } from "./ReceptionSheet";

/**
 * Entrepôt › Stock › Réceptions.
 *
 * LE BORD COLORÉ DIT QUI EST ATTENDU. Une pastille dit ce qu'une ligne EST ;
 * le liseré de 3 px dit qu'elle BLOQUE quelqu'un — rouge en retard, ambre
 * attend un manager. Il se lit en balayant la colonne du regard sans lire, et
 * il n'est porté que par les lignes qui demandent une action : si toutes les
 * lignes en ont un, aucune ne veut plus rien dire.
 *
 * LE SEGMENT EST UNE VUE, PAS UNE REQUÊTE. Il filtre une liste déjà chargée,
 * pour deux raisons. La première est que le changement de segment est alors
 * instantané. La seconde est qu'un filtre côté serveur faisait mentir les
 * compteurs : ils étaient comptés sur la liste retournée, donc choisir
 * « Attendues » affichait « À valider 0 » — le seul écran censé dire au manager
 * ce qui l'attend l'oubliait dès qu'on s'en servait.
 */

type Segment = "all" | "open" | "settled" | "unpaid";

/**
 * CINQ COLONNES, PAS HUIT.
 *
 * « Bâtiment » rejoint la référence — un agent n'en voit qu'un, un manager filtre
 * dessus — et « Statut » + « Paiement » partagent une cellule « État », parce
 * qu'on les lit d'un même regard : dans quel état, et est-ce payé. Moins de
 * trajet de l'œil, et de la place pour que le chiffre devienne lisible.
 */
const GRID =
  "grid items-center gap-x-4 " +
  "grid-cols-[minmax(190px,1.3fr)_minmax(130px,1.1fr)_minmax(118px,.85fr)_minmax(124px,.9fr)_minmax(168px,1fr)_26px]";

function matchesSegment(r: ProjectedReception, segment: Segment): boolean {
  switch (segment) {
    case "all":
      return true;
    case "open":
    case "settled":
      return r.status === segment;
    // « Impayées » n'est pas un statut en base : c'est une déduction de
    // somme(paiements) contre la valeur reçue. Le filtre porte donc sur l'état
    // déduit, ce qui évite d'écrire la règle une deuxième fois en SQL.
    case "unpaid":
      return r.payment_state === "unpaid" || r.payment_state === "partial";
  }
}

export function ReceptionsConsole({ locale, role }: { locale: string; role: Role }) {
  const t = useTranslations("warehouse.receptions");
  const [segment, setSegment] = useState<Segment>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { receptions, counts, currency, unassigned, isLoading, error, mutate } = useReceptions({});

  const visible = useMemo(
    () => receptions.filter((r) => matchesSegment(r, segment)),
    [receptions, segment],
  );

  const segments: { key: Segment; label: string; count: number; tone?: "warn" | "bad" }[] = [
    { key: "all", label: t("segAll"), count: counts.all },
    // « À solder » porte le compteur ambre, et lui seul : « Soldées 14 » est une
    // information, « À solder 2 » est une réclamation.
    { key: "open", label: t("segToSettle"), count: counts.open, tone: "warn" },
    { key: "settled", label: t("segSettled"), count: counts.settled },
    { key: "unpaid", label: t("segUnpaid"), count: counts.unpaid, tone: "bad" },
  ];

  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    maximumFractionDigits: 0,
  });

  /** Le mot qui accompagne le chiffre de tête. Un nombre nu ne dit pas de quoi il parle. */
  function unitWord(kind: ReturnType<typeof headlineQuantity>["kind"], damaged: number): string {
    if (kind === "cancelled") return t("unitsCancelled");
    if (kind === "expected") return t("unitsExpected");
    if (kind === "counted") return t("unitsCounted");
    return damaged > 0 ? "" : t("unitsPosted");
  }

  return (
    <div className="mx-auto w-full max-w-[1460px] px-4 py-4 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/*
         * `group` + un nom accessible, parce que « À valider » est à la fois un
         * FILTRE ici et un STATUT sur les lignes. Deux boutons portant le même
         * nom accessible sans contexte sont ambigus pour un lecteur d'écran.
         * Et ce niveau narrows ce qu'on regarde déjà : ce n'est pas un tablist.
         */}
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
          {segments.map((s) => {
            const active = segment === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSegment(s.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  active
                    ? "border-wh-ink-1 bg-wh-ink-1 text-white"
                    : "border-wh-border bg-wh-surface text-wh-ink-2 hover:bg-wh-sunken"
                }`}
              >
                {s.label}
                <span
                  className={`rounded-full px-1.5 py-px text-[11.5px] font-bold tabular-nums ${
                    active
                      ? "bg-white/20 text-white"
                      : s.tone === "warn" && s.count > 0
                        ? "bg-wh-warn-bg text-wh-warn"
                        : s.tone === "bad" && s.count > 0
                          ? "bg-wh-bad-bg text-wh-bad"
                          : "bg-wh-sunken text-wh-ink-2"
                  }`}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>

        {/*
          * PAS DE « NOUVELLE RÉCEPTION » ICI. Le document naît au QUAI, au
          * premier arrivage — un formulaire de bureau qui réclamait bâtiment,
          * fournisseur, numéro de bon et date avant d'accepter une seule unité
          * demandait la paperasse avant la marchandise.
          */}
      </div>

      {/*
       * « Aucun bâtiment ne vous est assigné » et « aucune réception » sont des
       * faits OPPOSÉS. Un agent non affecté ne voit rien par construction : le
       * dire l'envoie chez son responsable, alors qu'une liste vide l'enverrait
       * chercher des colis qui ne lui seront jamais montrés.
       */}
      {unassigned ? (
        <div className={`${WH_CARD} p-8 text-center`}>
          <AlertCircle className="mx-auto mb-3 text-wh-warn" size={26} />
          <p className="text-[15px] font-semibold text-wh-ink-1">{t("noSiteAssigned")}</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-wh-ink-2">
            {t("noSiteAssignedHint")}
          </p>
        </div>
      ) : error ? (
        <div className={`${WH_CARD} p-8 text-center`}>
          <p className="text-[14px] font-semibold text-wh-bad">{t("loadError")}</p>
          <p className="mt-1 text-[12.5px] text-wh-ink-3">{error.message}</p>
        </div>
      ) : isLoading && receptions.length === 0 ? (
        <div className={`${WH_CARD} p-8 text-center text-[13px] text-wh-ink-3`}>…</div>
      ) : visible.length === 0 ? (
        /*
         * « Rien ici » et « rien du tout » sont deux faits différents. Dire
         * « une livraison fournisseur commence ici » à quelqu'un qui vient de
         * filtrer sur « Impayées » l'envoie créer une réception alors qu'il
         * voulait juste savoir qu'il n'en a aucune d'impayée.
         */
        <div className={`${WH_CARD} p-8 text-center`}>
          <Inbox className="mx-auto mb-3 text-wh-ink-3" size={26} />
          <p className="text-[15px] font-semibold text-wh-ink-1">
            {receptions.length > 0 ? t("emptyFiltered") : t("empty")}
          </p>
          <p className="mt-1.5 text-[13px] text-wh-ink-2">
            {receptions.length > 0 ? t("emptyFilteredHint") : t("emptyHint")}
          </p>
        </div>
      ) : (
        <div className={`${WH_CARD} overflow-hidden`}>
          <div className={`${GRID} border-b border-wh-border px-5 pb-2.5 pt-3.5`}>
            <span className={WH_LABEL}>{t("colReference")}</span>
            <span className={WH_LABEL}>{t("colSupplier")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colQuantities")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colValue")}</span>
            <span className={WH_LABEL}>{t("colStatus")}</span>
            <span />
          </div>

          <ul>
            {visible.map((r) => {
              /*
               * UN SEUL SIGNAL DE COULEUR PAR LIGNE. Le liseré de 3 px se lit en
               * balayant la colonne sans lire un mot, et il n'est porté que par
               * ce qui bloque quelqu'un. Un fond teinté par-dessus ne dirait
               * rien de neuf et entrerait en concurrence avec les puces, qui
               * portent la vraie nuance — c'est ainsi qu'une ligne en retard
               * finissait par crier sur cinq canaux à la fois.
               */
              /*
               * LE LISERÉ NE MARQUE PLUS QUE LE RETARD. La seconde branche
               * cherchait `submitted`, un état supprimé le 3 octobre : elle ne
               * pouvait plus jamais être vraie. Un groupe OUVERT est le
               * fonctionnement normal — le quai compte, le bureau solde une
               * fois la semaine — et le teinter ferait crier la routine.
               */
              const stripe = r.is_late ? WH_STRIPE.bad : "";

              const headline = headlineQuantity(r);
              const site =
                locale === "ar" ? (r.warehouse_name_ar ?? r.warehouse_name) : r.warehouse_name;
              // Qui a touché le document : celui qui a compté tant qu'il est
              // ouvert, celui qui l'a soldé ensuite.
              const who =
                r.status === "open"
                  ? r.counted_by_name
                    ? t("countedBy", { name: r.counted_by_name })
                    : null
                  : r.settled_by_name
                    ? t("settledBy", { name: r.settled_by_name })
                    : null;

              return (
                <li key={r.id} className="border-b border-wh-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    className={`${GRID} ${stripe} w-full px-5 py-4 text-start hover:bg-wh-ok-tint`}
                  >
                    {/* Référence, et sous elle le fait qui compte : ce qui bloque,
                        ou à défaut le bâtiment et qui a touché le document. */}
                    <span className="min-w-0">
                      <span className="block font-mono text-[13.5px] font-semibold tabular-nums">
                        {r.reference}
                      </span>
                      {r.is_late && r.days_late !== null ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-wh-bad">
                          <AlertCircle size={12} strokeWidth={2.4} />
                          {t("lateBy", { days: r.days_late })}
                        </span>
                      ) : null}
                      {/*
                        * LE BÂTIMENT EST UN NŒUD DE TEXTE À LUI. Collé à la
                        * suite dans une seule chaîne, « Tripoli » devient
                        * « Tripoli · comptée par Adel » et n'est plus
                        * retrouvable — ni par un lecteur d'écran, ni par un test.
                        * Le séparateur est donc un FRÈRE, jamais une concaténation.
                        */}
                      <span className="mt-1 block truncate text-[11.5px] text-wh-ink-3">
                        {site ? <span>{site}</span> : null}
                        {site && who ? <span className="mx-1">·</span> : null}
                        {who ? <span>{who}</span> : null}
                      </span>
                    </span>

                    <span className="truncate text-[13px]" dir="auto">
                      {r.supplier_name ?? "—"}
                    </span>

                    {/*
                     * LE CHIFFRE EST L'ANCRE DE LA LIGNE : 16 px, et jamais nu.
                     * `totals.units` somme le REÇU, donc sur une attendue il vaut
                     * 0 — et un 0 affiché se lirait « rien n'est arrivé ».
                     */}
                    <span className="whitespace-nowrap text-end">
                      {headline.value === null ? (
                        <span className="font-mono text-[16px] text-wh-ink-3">—</span>
                      ) : (
                        <>
                          <span className="font-mono text-[16px] font-semibold tabular-nums">
                            {nf.format(headline.value)}
                          </span>
                          {r.totals.damaged > 0 && headline.kind === "units" ? (
                            <span className="ms-1.5 text-[11.5px] font-medium text-wh-warn">
                              {t("unitsDamagedSuffix", { count: r.totals.damaged })}
                            </span>
                          ) : (
                            <span className="ms-1.5 text-[11.5px] text-wh-ink-3">
                              {unitWord(headline.kind, r.totals.damaged)}
                            </span>
                          )}
                        </>
                      )}
                    </span>

                    {/*
                     * `null` = soit rien n'est encore arrivé, soit ce lecteur n'a
                     * pas droit aux chiffres d'argent. Dans les deux cas un tiret
                     * dit « inconnu » ; un zéro mentirait.
                     */}
                    <span className="whitespace-nowrap text-end">
                      {r.totals.value === null ? (
                        <span className="font-mono text-[15px] text-wh-ink-3">—</span>
                      ) : (
                        <>
                          <span className="font-mono text-[15px] font-semibold tabular-nums">
                            {nf.format(r.totals.value)}
                          </span>
                          <span className="ms-1 text-[10.5px] font-semibold text-wh-ink-3">
                            {currency}
                          </span>
                        </>
                      )}
                    </span>

                    {/* Statut et paiement se lisent d'un même regard. */}
                    <span className="flex flex-wrap items-center gap-2">
                      <ReceptionStatusChip status={r.status} />
                      <PaymentChip
                        state={r.payment_state}
                        percent={paidPercent({ value: r.totals.value, paid: r.paid_total ?? 0 })}
                      />
                    </span>

                    {/* La ligne s'ouvre. Rien ne le disait. */}
                    <span className="grid place-items-center text-wh-ink-3" aria-hidden>
                      <ChevronRight size={16} className="rtl:-scale-x-100" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {openId ? (
        <ReceptionSheet
          id={openId}
          locale={locale}
          role={role}
          currency={currency}
          onClose={() => setOpenId(null)}
          onChanged={() => void mutate()}
        />
      ) : null}

    </div>
  );
}
