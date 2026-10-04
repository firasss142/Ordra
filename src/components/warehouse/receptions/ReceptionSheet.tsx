"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronDown,
  Check,
  Plus,
  Trash2,
  Image as ImageIcon,
  Undo2,
  Smartphone,
} from "lucide-react";
import type { Role } from "@/types";
import { useReception } from "@/hooks/useReceptions";
import { canSeeReceptionCosts, canRecordArrival } from "@/lib/receptions/permissions";
import { lineVariance, receptionTotals, paidPercent } from "@/lib/receptions/derive";
import { ReceptionFeesBlock } from "./ReceptionFeesBlock";
import { ReceptionLineEditor, type LinePatch } from "./ReceptionLineEditor";
import { WH_CARD, WH_LABEL, WH_BTN, WH_BTN_PRIMARY } from "@/components/warehouse/console/tokens";
import { ReceptionStatusChip, PaymentChip } from "./ReceptionStatusChip";
import { ReceptionSettleDialog } from "./ReceptionSettleDialog";
import { ReceptionReverseDialog } from "./ReceptionReverseDialog";
import { ReceptionDockFlow } from "./ReceptionDockFlow";

/**
 * La feuille d'une réception — plein écran, pas une modale de 480 px.
 *
 * Un document à plusieurs lignes ne tient pas dans la modale du système, et un
 * seul composant sert ainsi le bureau et le téléphone, où le plein écran est la
 * seule option possible.
 *
 * LA BARRE DE SAISIE EST LA CHOSE UTILE. Sur une réception de quarante lignes,
 * « il en reste une à compter » est invisible dans un tableau. Un champ non
 * compté reste en pointillés et dit « pas encore comptée » — pas `0`, qui
 * voudrait dire « rien n'est arrivé ».
 */

const LINE_GRID =
  "grid items-center gap-x-3 " +
  "grid-cols-[minmax(200px,2.4fr)_88px_108px_88px] md:grid-cols-[minmax(220px,2.4fr)_88px_108px_88px_108px_116px]";

export function ReceptionSheet({
  id,
  locale,
  role,
  currency,
  onClose,
  onChanged,
}: {
  id: string;
  locale: string;
  role: Role;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const { reception, isLoading, mutate } = useReception(id);
  const [posting, setPosting] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Les modifications vivent en local jusqu'à l'enregistrement explicite.
   *
   * Pas d'enregistrement automatique à la frappe : la route remplace les lignes
   * EN BLOC (le client tient la liste complète, ce qui évite les lignes
   * fantômes), donc un appel par caractère tapé réécrirait la table à chaque
   * touche. Et sur un quai, un réseau qui tombe au milieu d'une saisie
   * auto-enregistrée laisse un document à moitié écrit sans le dire.
   */
  const [edits, setEdits] = useState<Record<string, LinePatch>>({});
  const withCosts = canSeeReceptionCosts(role);

  /*
   * Sur un téléphone, le tableau du bureau est le mauvais outil : la maquette §6
   * place l'agent dans un comptage ligne par ligne. On y entre donc tout seul
   * quand l'écran est étroit — mais une seule fois par ouverture de la feuille,
   * pour que fermer le comptage ne devienne pas un piège qui se rouvre.
   */
  const autoCounted = useRef(false);
  useEffect(() => {
    if (autoCounted.current || !reception) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const narrow = window.matchMedia("(max-width: 767px)").matches;
    const editableNow =
      canRecordArrival(role) &&
      (reception.status === "open") &&
      reception.lines.length > 0;
    if (narrow && editableNow) {
      autoCounted.current = true;
      setCounting(true);
    }
  }, [reception, role]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !posting && !reversing && !counting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, posting, reversing, counting]);

  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    maximumFractionDigits: 0,
  });
  /*
   * Une date de bon de livraison se lit « 28 sept 2026 ». `2026-09-28` est un
   * format de stockage : on ne le montre pas à quelqu'un qui tient un carton.
   */
  const df = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === "ar" ? "ar" : "fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  async function act(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return false;
      }
      await mutate();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Enregistre les quantités saisies.
   *
   * La route remplace les lignes EN BLOC, donc on renvoie TOUTES les lignes —
   * celles qu'on n'a pas touchées comprises. Envoyer seulement les modifiées
   * supprimerait les autres.
   */
  async function saveLines() {
    if (busy || !reception) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: reception.lines.map((l) => {
            const patch = edits[l.id];
            return {
              product_id: l.product_id,
              variant_id: l.variant_id,
              ordered_qty: l.ordered_qty,
              received_qty: patch ? patch.received_qty : l.received_qty,
              damaged_qty: patch ? patch.damaged_qty : l.damaged_qty,
              unit_cost: patch ? patch.unit_cost : (l.unit_cost ?? null),
            };
          }),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return false;
      }
      setEdits({});
      await mutate();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !reception) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-wh-bg">
        <p className="text-[13px] text-wh-ink-3">…</p>
      </div>
    );
  }

  const r = reception;
  // « Comptée » veut dire qu'un humain a mis un nombre — y compris zéro, qui est
  // une réponse. `null` veut dire que personne n'a encore regardé.
  // Une ligne « comptée » porte un nombre — zéro compris, qui est une réponse.
  const effective = (l: (typeof r.lines)[number]) =>
    edits[l.id] ? edits[l.id].received_qty : l.received_qty;
  const counted = r.lines.filter((l) => effective(l) !== null).length;
  const remaining = r.lines.length - counted;

  // Un brouillon ou une déclaration se modifie ; une réception validée est
  // définitive, et le déclencheur en base le refuse de toute façon.
  const editable =
    canRecordArrival(role) && (r.status === "open");
  const dirty = Object.keys(edits).length > 0;

  /*
   * Les totaux du pied suivent la SAISIE EN COURS, pas la dernière version
   * enregistrée. Un pied qui contredit les champs juste au-dessus est un écran
   * qu'on cesse de croire — et celui-ci porte un geste qui bouge du stock.
   */
  const liveTotals = dirty
    ? receptionTotals(
        r.lines.map((l) => {
          const patch = edits[l.id];
          return {
            ordered_qty: l.ordered_qty,
            received_qty: patch ? patch.received_qty : l.received_qty,
            damaged_qty: patch ? patch.damaged_qty : l.damaged_qty,
            unit_cost: withCosts ? (patch ? patch.unit_cost : (l.unit_cost ?? null)) : null,
          };
        }),
      )
    : r.totals;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-wh-bg">
      <div className="mx-auto w-full max-w-[1200px] p-4 md:p-6">
        <div className={`${WH_CARD} overflow-hidden`}>
          {/* ── en-tête ── */}
          <div className="flex flex-wrap items-start gap-4 border-b border-wh-border p-4 md:p-5">
            <button
              type="button"
              onClick={onClose}
              aria-label={t("cancel")}
              className="grid h-8 w-8 flex-none place-items-center rounded-[8px] border border-wh-border text-wh-ink-2 hover:bg-wh-sunken"
            >
              <ChevronLeft size={17} className="rtl:-scale-x-100" />
            </button>

            <div className="min-w-0 flex-1">
              <h3 className="flex flex-wrap items-center gap-2.5 font-mono text-[18px] font-semibold tracking-tight">
                {r.reference}
                <ReceptionStatusChip status={r.status} />
              </h3>
              {/*
               * LES FAITS D'EN-TÊTE SONT UNE LIGNE, PAS CINQ BLOCS.
               *
               * Ils sont la LÉGENDE du document, pas son contenu : cinq couples
               * libellé-en-capitales / valeur occupaient autant de hauteur que
               * trois lignes de produits, et poussaient la première quantité hors
               * du premier écran. Le libellé disparaît là où la valeur se nomme
               * elle-même — personne ne confond « Tripoli » avec un fournisseur.
               */}
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-wh-ink-2">
                {r.supplier_name ? (
                  <>
                    <span className="font-semibold text-wh-ink-1" dir="auto">
                      {r.supplier_name}
                    </span>
                    <Sep />
                  </>
                ) : null}
                {r.supplier_ref ? (
                  <>
                    <span>
                      {t("deliveryNote")} <span className="font-mono">{r.supplier_ref}</span>
                    </span>
                    <Sep />
                  </>
                ) : null}
                <span>
                  {locale === "ar" ? (r.warehouse_name_ar ?? r.warehouse_name) : r.warehouse_name}
                </span>
                {r.counted_by_name ? (
                  <>
                    <Sep />
                    <span>
                      {t("countedBy", { name: r.counted_by_name })}
                      {/*
                       * La maquette appelle cette date « Arrivée ». C'est en
                       * vérité la date de la DÉCLARATION, et les deux ne
                       * coïncident que si l'agent compte le jour de la livraison :
                       * rien ne nous autorise à affirmer un jour d'arrivée que
                       * personne n'a saisi.
                       */}
                      {r.arrival_date ? ` · ${df(r.arrival_date)}` : ""}
                    </span>
                  </>
                ) : null}
                {r.settled_by_name ? (
                  <>
                    <Sep />
                    <span>{t("settledBy", { name: r.settled_by_name })}</span>
                  </>
                ) : null}
                {(r.status === "open") && r.lines.length > 0 ? (
                  <>
                    <Sep />
                    <span className="font-semibold text-wh-ok">
                      {t("entryProgress", { done: counted, total: r.lines.length })}
                    </span>
                    {remaining > 0 ? (
                      <span className="font-semibold text-wh-warn">
                        {t("entryRemaining", { count: remaining })}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex flex-none flex-wrap items-center gap-2.5">
              {/*
               * L'entrée du comptage une-ligne-à-la-fois. On ne demande pas à
               * quelqu'un debout devant une palette de remplir un tableau, donc
               * sur un écran étroit ce mode s'ouvre de lui-même (une seule fois,
               * et le fermer n'y ramène pas) ; au bureau il reste un choix.
               */}
              {editable ? (
                <button type="button" className={WH_BTN} onClick={() => setCounting(true)}>
                  <Smartphone size={16} />
                  {t("countOnPhone")}
                </button>
              ) : null}
              {r.photo_url ? (
                <a href={r.photo_url} target="_blank" rel="noreferrer" className={WH_BTN}>
                  <ImageIcon size={16} />
                  {t("deliveryNote")}
                </a>
              ) : null}
            </div>
          </div>

          {/*
           * LA PROGRESSION EST UN FILET DE 3 PX, PAS UN BANDEAU.
           *
           * C'était la troisième bande horizontale avant la première quantité.
           * Le chiffre — « saisie 4 / 5 » — vit maintenant dans la ligne de
           * légende ci-dessus ; il ne reste ici que ce qui a besoin d'être
           * continu pour être lu d'un coup d'œil : la longueur.
           */}
          {(r.status === "open") && r.lines.length > 0 ? (
            <div
              data-testid="reception-progress-rail"
              className="h-[3px] w-full bg-wh-sunken"
              role="presentation"
            >
              <div
                className="h-full bg-wh-ok"
                style={{ width: `${r.lines.length ? (counted / r.lines.length) * 100 : 0}%` }}
              />
            </div>
          ) : null}

          {/* ── lignes ── */}
          <div
            className={`${LINE_GRID} border-b border-wh-border bg-wh-sunken px-4 pb-2.5 pt-3 md:px-5`}
          >
            <span className={WH_LABEL}>{t("colProduct")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colExpected")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colReceived")}</span>
            <span className={`${WH_LABEL} text-end`}>{t("colDamaged")}</span>
            {withCosts ? (
              <>
                <span className={`${WH_LABEL} hidden text-end md:block`}>{t("colUnitCost")}</span>
                <span className={`${WH_LABEL} hidden text-end md:block`}>{t("colTotal")}</span>
              </>
            ) : null}
          </div>

          <ul>
            {r.lines.map((l) => {
              const draft = edits[l.id];
              // La ligne affichée est le brouillon local s'il existe, sinon la
              // version du serveur. L'écart est recalculé sur place pour que le
              // chiffre bouge sous le doigt, sans aller-retour réseau.
              const shown = draft
                ? {
                    ...l,
                    received_qty: draft.received_qty,
                    damaged_qty: draft.damaged_qty,
                    unit_cost: draft.unit_cost,
                    variance: lineVariance({
                      expected: l.ordered_qty,
                      received: draft.received_qty,
                    }),
                    line_value:
                      draft.unit_cost !== null && draft.received_qty !== null
                        ? draft.unit_cost * draft.received_qty
                        : null,
                  }
                : l;

              return (
                <li
                  key={l.id}
                  /*
                   * Une ligne comptée se teinte. Sur quarante lignes, « où me
                   * suis-je arrêté » doit se voir sans relire chaque champ.
                   */
                  className={`${LINE_GRID} border-b border-wh-border px-4 py-3 last:border-b-0 md:px-5 ${
                    shown.received_qty !== null ? "bg-wh-ok-bg/15" : ""
                  }`}
                >
                  <ReceptionLineEditor
                    line={shown}
                    withCosts={withCosts}
                    readOnly={!editable}
                    onChange={(patch) => setEdits((prev) => ({ ...prev, [l.id]: patch }))}
                  />
                </li>
              );
            })}
          </ul>

          {/*
            * LES FRAIS D'APPROCHE, entre les lignes et les totaux — parce que
            * c'est exactement là qu'ils entrent dans le calcul. Réservés à qui
            * voit l'argent, et figés dès que la réception est validée : le coût
            * de revient est alors écrit dans le registre.
            */}
          {withCosts ? (
            <ReceptionFeesBlock
              reception={r}
              currency={currency}
              editable={r.status === "open"}
              onChanged={mutate}
            />
          ) : null}

          {/* ── totaux + action ── */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-wh-border bg-wh-sunken px-4 py-3.5 md:px-5">
            {/*
             * « Valeur reçue » EST le chiffre qu'un manager vient chercher avant
             * de valider : il passe en tête et à 25 px. Quatre totaux du même
             * corps obligeaient à lire les quatre libellés pour trouver le bon.
             */}
            <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
              {/*
                * LE CHIFFRE DE TÊTE EST LE COÛT DE REVIENT, pas le prix du
                * fournisseur : c'est lui qui devient le COGS. Tant qu'aucun
                * frais n'est saisi les deux sont égaux, et on n'affiche que
                * « valeur reçue » pour ne pas inventer une distinction.
                */}
              {withCosts ? (
                <Total
                  label={(r.fees_total ?? 0) > 0 ? t("landedTotal") : t("totalValue")}
                  lead
                >
                  {liveTotals.value === null ? (
                    <span className="text-wh-ink-3">—</span>
                  ) : (
                    <>
                      {nf.format(liveTotals.value + (r.fees_total ?? 0))}
                      <span className="ms-1.5 font-sans text-[11.5px] font-semibold text-wh-ink-2">
                        {currency}
                      </span>
                    </>
                  )}
                </Total>
              ) : null}
              {withCosts && (r.fees_total ?? 0) > 0 ? (
                <Total label={t("totalValue")}>
                  {liveTotals.value === null ? (
                    <span className="text-wh-ink-3">—</span>
                  ) : (
                    nf.format(liveTotals.value)
                  )}
                </Total>
              ) : null}
              <Total label={t("totalUnits")}>{nf.format(liveTotals.units)}</Total>
              <Total label={t("totalDamaged")} tone={liveTotals.damaged > 0 ? "warn" : undefined}>
                {nf.format(liveTotals.damaged)}
              </Total>
              <Total label={t("totalLines")}>{nf.format(liveTotals.lines)}</Total>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/*
               * Enregistrer d'abord, agir ensuite. Tant qu'une saisie n'est pas
               * enregistrée, déclarer ou valider porterait sur les chiffres du
               * SERVEUR et non sur ceux que la personne a sous les yeux — c'est
               * la façon la plus sûre d'entrer en stock une quantité que
               * personne n'a voulue.
               */}
              {dirty ? (
                <>
                  <span className="text-[12.5px] font-semibold text-wh-warn">
                    {t("unsavedChanges")}
                  </span>
                  <button
                    type="button"
                    className={WH_BTN}
                    disabled={busy}
                    onClick={() => setEdits({})}
                  >
                    {t("discard")}
                  </button>
                  <button
                    type="button"
                    className={WH_BTN_PRIMARY}
                    disabled={busy}
                    onClick={() => void saveLines()}
                  >
                    <Check size={17} strokeWidth={2.2} />
                    {t("savePrices")}
                  </button>
                </>
              ) : (
                <>
                  {/*
                   * UNE SEULE ACTION PRIMAIRE. Qui peut valider n'a aucune
                   * raison de déclarer d'abord — il est à la fois déclarant et
                   * validateur, et deux boutons verts dont l'un contient l'autre
                   * ne font que demander « lequel des deux ? » à quelqu'un qui
                   * voulait juste entrer sa marchandise. L'API, elle, reste
                   * honnête : `can.submit` dit que la route l'accepterait.
                   */}

                  {/*
                   * LA TROISIÈME ISSUE. Sans « renvoyer », un manager qui voit
                   * une erreur n'a que deux choix : valider ce qui est faux, ou
                   * laisser la réception bloquée dans sa file pour toujours.
                   * Rien n'a bougé en stock, donc il n'y a rien à annuler.
                   */}

                  {r.can.settle ? (
                    <button
                      type="button"
                      className={WH_BTN_PRIMARY}
                      disabled={busy}
                      onClick={() => setPosting(true)}
                    >
                      <Check size={17} strokeWidth={2.2} />
                      {t("settle")}
                    </button>
                  ) : null}
                  {/*
                   * Contre-passer est discret et destructeur : il ne porte ni la
                   * couleur primaire ni la position d'une action courante, et il
                   * n'apparaît que sur une réception déjà validée.
                   */}
                  {r.can.reverse ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-[10px] border border-wh-bad-edge bg-wh-surface px-[15px] py-[9px] text-[13.5px] font-semibold text-wh-bad hover:bg-wh-bad-bg"
                      disabled={busy}
                      onClick={() => setReversing(true)}
                    >
                      <Undo2 size={16} className="rtl:-scale-x-100" />
                      {t("reverse")}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {error ? (
            <p className="border-t border-wh-bad-edge bg-wh-bad-bg px-4 py-2.5 text-[13px] font-medium text-wh-bad md:px-5">
              {error}
            </p>
          ) : null}

          {/* ── paiements ── */}
          {withCosts && r.payment_state !== null ? (
            <PaymentsBlock
              receptionId={r.id}
              payments={r.payments}
              paidTotal={r.paid_total ?? 0}
              value={r.totals.value}
              outstanding={r.outstanding}
              state={r.payment_state}
              currency={currency}
              canPay={r.can.pay}
              onChanged={() => {
                void mutate();
                onChanged();
              }}
            />
          ) : null}
        </div>
      </div>

      {posting ? (
        <ReceptionSettleDialog
          reception={r}
          currency={currency}
          onClose={() => setPosting(false)}
          onSettled={() => {
            setPosting(false);
            void mutate();
            onChanged();
          }}
        />
      ) : null}

      {reversing ? (
        <ReceptionReverseDialog
          reception={r}
          onClose={() => setReversing(false)}
          onReversed={() => {
            setReversing(false);
            void mutate();
            onChanged();
          }}
        />
      ) : null}

      {counting ? (
        <ReceptionDockFlow
          reception={r}
          warehouseId={r.warehouse_id}
          marketId={r.market_id}
          warehouseName={locale === "ar" ? (r.warehouse_name_ar ?? r.warehouse_name) : r.warehouse_name}
          onClose={() => setCounting(false)}
          onChanged={async () => {
            await mutate();
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** Le point médian de la ligne de légende. Plus clair que le texte qu'il sépare. */
function Sep() {
  return (
    <span className="text-wh-border-strong" aria-hidden>
      ·
    </span>
  );
}

function Total({
  label,
  tone,
  lead,
  children,
}: {
  label: string;
  tone?: "warn";
  /** Le total dominant du pied — un seul par écran. */
  lead?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={WH_LABEL}>{label}</div>
      <div
        {...(lead ? { "data-testid": "reception-total-value" } : {})}
        className={`mt-1 font-mono font-semibold tabular-nums ${
          lead ? "text-[25px] tracking-[-0.02em]" : "text-[19px]"
        } ${tone === "warn" ? "text-wh-warn" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Le bloc paiement.
 *
 * « payé / partiellement payé » n'est pas stocké : il se déduit de la somme des
 * versements contre la valeur reçue. Deux acomptes sur une livraison marchent
 * donc d'emblée, et le reste à payer ne peut pas se désynchroniser de ses lignes.
 */
function PaymentsBlock({
  receptionId,
  payments,
  paidTotal,
  value,
  outstanding,
  state,
  currency,
  canPay,
  onChanged,
}: {
  receptionId: string;
  payments: { id: string; paid_at: string; amount: number; method: string | null; note: string | null }[];
  paidTotal: number;
  value: number | null;
  outstanding: number | null;
  state: string;
  currency: string;
  canPay: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  /*
   * LA DATE EST CELLE DU VERSEMENT, PAS CELLE DE LA SAISIE. Un acompte viré
   * jeudi et enregistré lundi n'a pas la date de lundi, et c'est cette liste
   * qu'on relira pour savoir quand le fournisseur a été payé. Elle part
   * pré-remplie à aujourd'hui, qui est le cas courant.
   */
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cf = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  const pct = value && value > 0 ? Math.min((paidTotal / value) * 100, 100) : 0;

  async function add() {
    const parsed = Number.parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${receptionId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsed,
          method,
          paid_at: paidAt || undefined,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return;
      }
      setAmount("");
      setNote("");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(paymentId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(
        `/api/warehouse/receptions/${receptionId}/payments?payment_id=${encodeURIComponent(paymentId)}`,
        { method: "DELETE" },
      );
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const METHODS: Record<string, string> = {
    cash: t("methodCash"),
    bank_transfer: t("methodBankTransfer"),
    cheque: t("methodCheque"),
    other: t("methodOther"),
  };

  return (
    <div className="border-t border-wh-border">
      {/*
       * LE BLOC EST REPLIÉ, ET SON TITRE PORTE DÉJÀ LE FAIT ENTIER.
       *
       * « acompte 40 % · reste 11 232,000 LYD » répond à la question qu'on se
       * pose en ouvrant une réception validée. La liste des versements, elle, ne
       * sert qu'à en ajouter un ou à en retirer un : on l'ouvre pour AGIR, pas
       * pour lire. Elle occupait un tiers de la feuille pour une ligne utile.
       */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-3 p-4 text-start hover:bg-wh-sunken/60 md:px-5"
      >
        <ChevronDown
          size={15}
          className={`flex-none text-wh-ink-3 transition-transform ${open ? "" : "-rotate-90 rtl:rotate-90"}`}
        />
        <span className={WH_LABEL}>{t("payments")}</span>
        <PaymentChip state={state} percent={paidPercent({ value, paid: paidTotal })} />
        {outstanding !== null && outstanding > 0 ? (
          <span className="ms-auto font-mono text-[14px] font-semibold tabular-nums text-wh-bad">
            {t("paymentRemaining")} {cf.format(outstanding)} {currency}
          </span>
        ) : outstanding !== null ? (
          <span className="ms-auto font-mono text-[14px] font-semibold text-wh-ok">
            {t("paymentSettled")}
          </span>
        ) : null}
      </button>

      {!open ? null : (
      <div className="px-4 pb-4 md:px-5 md:pb-5">
      {value !== null ? (
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-wh-sunken">
          <div className="h-full bg-wh-ok" style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {payments.length > 0 ? (
        <ul>
          {payments.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-[96px_1fr_auto_28px] items-center gap-x-3 border-b border-wh-border py-2.5 last:border-b-0"
            >
              <span className="font-mono text-[12.5px] text-wh-ink-2">{p.paid_at}</span>
              <span className="truncate text-[13px]">
                {p.method ? METHODS[p.method] : "—"}
                {p.note ? <span className="ms-2 text-[12px] text-wh-ink-3">{p.note}</span> : null}
              </span>
              <span className="text-end font-mono text-[13.5px] font-semibold tabular-nums">
                {cf.format(p.amount)}
              </span>
              {canPay ? (
                <button
                  type="button"
                  aria-label={t("deletePayment")}
                  onClick={() => void remove(p.id)}
                  className="grid place-items-center text-wh-ink-3 hover:text-wh-bad"
                >
                  <Trash2 size={15} />
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {outstanding !== null ? (
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-wh-border-strong pt-3">
          <span className="text-[13px] font-semibold">
            {outstanding > 0 ? t("paymentRemaining") : t("paymentSettled")}
          </span>
          <span
            className={`font-mono text-[17px] font-bold tabular-nums ${
              outstanding > 0 ? "text-wh-bad" : "text-wh-ok"
            }`}
          >
            {cf.format(outstanding)} {currency}
          </span>
        </div>
      ) : null}

      {canPay ? (
        adding ? (
          <div className="mt-3 flex flex-wrap items-end gap-2.5">
            <label className="min-w-[110px] flex-1">
              <span className={WH_LABEL}>{t("paymentAmount")}</span>
              <input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-[6px] border border-wh-border px-2.5 py-2 text-end font-mono text-[14px] tabular-nums"
              />
            </label>
            <label>
              <span className={WH_LABEL}>{t("paymentDate")}</span>
              <input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="mt-1 rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px]"
              />
            </label>
            <label>
              <span className={WH_LABEL}>{t("paymentMethod")}</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1 rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px]"
              >
                {Object.entries(METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[140px] flex-1">
              <span className={WH_LABEL}>{t("paymentNote")}</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                dir="auto"
                className="mt-1 w-full rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px]"
              />
            </label>
            <button type="button" className={WH_BTN_PRIMARY} disabled={busy} onClick={() => void add()}>
              {t("save")}
            </button>
            <button type="button" className={WH_BTN} onClick={() => setAdding(false)}>
              {t("cancel")}
            </button>
          </div>
        ) : (
          <button type="button" className={`${WH_BTN} mt-3`} onClick={() => setAdding(true)}>
            <Plus size={16} />
            {t("paymentAdd")}
          </button>
        )
      ) : null}

      {error ? <p className="mt-2 text-[12.5px] font-medium text-wh-bad">{error}</p> : null}
      </div>
      )}
    </div>
  );
}
