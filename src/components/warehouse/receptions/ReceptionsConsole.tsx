"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, AlertCircle, Clock, Inbox } from "lucide-react";
import type { Role } from "@/types";
import { useReceptions } from "@/hooks/useReceptions";
import { canDraftReception } from "@/lib/receptions/permissions";
import { WH_CARD, WH_LABEL, WH_BTN_PRIMARY, WH_STRIPE } from "@/components/warehouse/console/tokens";
import { ReceptionStatusChip, PaymentChip } from "./ReceptionStatusChip";
import { ReceptionSheet } from "./ReceptionSheet";
import { ReceptionCreateDialog } from "./ReceptionCreateDialog";

/**
 * Entrepôt › Stock › Réceptions.
 *
 * LE BORD COLORÉ DIT QUI EST ATTENDU. Une pastille dit ce qu'une ligne EST ;
 * le liseré de 3 px dit qu'elle BLOQUE quelqu'un — rouge en retard, ambre
 * attend un manager. Il se lit en balayant la colonne du regard sans lire, et
 * il n'est porté que par les lignes qui demandent une action : si toutes les
 * lignes en ont un, aucune ne veut plus rien dire.
 */

type Segment = "all" | "draft" | "submitted" | "posted" | "unpaid";

const GRID =
  "grid items-center gap-x-3 " +
  "grid-cols-[minmax(140px,1.1fr)_minmax(96px,.7fr)_112px_minmax(150px,1.3fr)_minmax(110px,.9fr)_minmax(130px,1fr)_minmax(118px,.9fr)]";

export function ReceptionsConsole({ locale, role }: { locale: string; role: Role }) {
  const t = useTranslations("warehouse.receptions");
  const [segment, setSegment] = useState<Segment>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { receptions, counts, currency, unassigned, isLoading, error, mutate } = useReceptions({
    status: segment === "all" || segment === "unpaid" ? (segment === "unpaid" ? "unpaid" : null) : segment,
  });

  const segments: { key: Segment; label: string; count: number; tone?: "warn" | "bad" }[] = [
    { key: "all", label: t("segAll"), count: counts.all },
    { key: "draft", label: t("segExpected"), count: counts.draft },
    { key: "submitted", label: t("segToValidate"), count: counts.submitted, tone: "warn" },
    { key: "posted", label: t("segPosted"), count: counts.posted },
  ];

  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    maximumFractionDigits: 0,
  });

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
                        : "bg-wh-sunken text-wh-ink-2"
                  }`}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>

        {canDraftReception(role) ? (
          <button type="button" className={WH_BTN_PRIMARY} onClick={() => setCreating(true)}>
            <Plus size={16} strokeWidth={2.2} />
            {t("new")}
          </button>
        ) : null}
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
      ) : receptions.length === 0 ? (
        <div className={`${WH_CARD} p-8 text-center`}>
          <Inbox className="mx-auto mb-3 text-wh-ink-3" size={26} />
          <p className="text-[15px] font-semibold text-wh-ink-1">{t("empty")}</p>
          <p className="mt-1.5 text-[13px] text-wh-ink-2">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className={`${WH_CARD} overflow-hidden`}>
          <div className={`${GRID} border-b border-wh-border px-[18px] pb-2.5 pt-3.5`}>
            <span className={WH_LABEL}>{t("colReference")}</span>
            <span className={WH_LABEL}>{t("colSite")}</span>
            <span className={WH_LABEL}>{t("colStatus")}</span>
            <span className={WH_LABEL}>{t("colSupplier")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colQuantities")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colValue")}</span>
            <span className={WH_LABEL}>{t("colPayment")}</span>
          </div>

          <ul>
            {receptions.map((r) => {
              // Le liseré n'est porté que par ce qui bloque quelqu'un.
              const stripe = r.is_late
                ? WH_STRIPE.bad
                : r.status === "submitted"
                  ? WH_STRIPE.warn
                  : "";
              const band = r.is_late
                ? "bg-wh-bad-bg/35"
                : r.status === "submitted"
                  ? "bg-wh-warn-bg/30"
                  : "";

              return (
                <li key={r.id} className="border-b border-wh-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    className={`${GRID} ${stripe} ${band} w-full px-[18px] py-3.5 text-start hover:bg-wh-sunken/60`}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[13px] font-semibold tabular-nums">
                        {r.reference}
                      </span>
                      {r.is_late && r.days_late !== null ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-wh-bad">
                          <AlertCircle size={12} strokeWidth={2.4} />
                          {t("lateBy", { days: r.days_late })}
                        </span>
                      ) : r.status === "submitted" ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-wh-warn">
                          <Clock size={12} strokeWidth={2.4} />
                          {t("waitingManager")}
                        </span>
                      ) : r.status === "draft" && r.expected_at ? (
                        <span className="mt-0.5 block text-[11.5px] text-wh-ink-3">
                          {t("expectedOn", { date: r.expected_at })}
                        </span>
                      ) : r.posted_by_name ? (
                        <span className="mt-0.5 block text-[11.5px] text-wh-ink-3">
                          {t("postedBy", { name: r.posted_by_name })}
                        </span>
                      ) : null}
                    </span>

                    <span className="truncate text-[13px] font-medium">
                      {locale === "ar" ? (r.warehouse_name_ar ?? r.warehouse_name) : r.warehouse_name}
                    </span>

                    <span>
                      <ReceptionStatusChip status={r.status} />
                    </span>

                    <span className="truncate text-[13px]" dir="auto">
                      {r.supplier_name ?? "—"}
                    </span>

                    <span className="text-end font-mono text-[13.5px] font-semibold tabular-nums">
                      {nf.format(r.totals.units)}
                      {r.totals.damaged > 0 ? (
                        <span className="ms-1 font-sans text-[11.5px] font-medium text-wh-warn">
                          {t("unitsDamagedSuffix", { count: r.totals.damaged })}
                        </span>
                      ) : null}
                    </span>

                    {/*
                     * `null` = soit rien n'est encore arrivé, soit ce lecteur
                     * n'a pas droit aux chiffres d'argent. Dans les deux cas un
                     * tiret dit « inconnu » ; un zéro mentirait.
                     */}
                    <span className="text-end font-mono text-[13.5px] font-semibold tabular-nums">
                      {r.totals.value === null ? (
                        <span className="text-wh-ink-3">—</span>
                      ) : (
                        <>
                          {nf.format(r.totals.value)}
                          <span className="ms-1 font-sans text-[11px] font-semibold text-wh-ink-3">
                            {currency}
                          </span>
                        </>
                      )}
                    </span>

                    <span>
                      <PaymentChip
                        state={r.payment_state}
                        outstanding={r.outstanding}
                        currency={currency}
                      />
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

      {creating ? (
        <ReceptionCreateDialog
          role={role}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void mutate();
            setOpenId(id);
          }}
        />
      ) : null}
    </div>
  );
}
