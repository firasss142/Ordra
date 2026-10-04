"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import type { ProjectedReception } from "@/lib/receptions/project";
import { WH_BTN, WH_BTN_PRIMARY } from "@/components/warehouse/console/tokens";

/**
 * SOLDER — le geste du bureau, et la barrière du rapprochement.
 *
 * Le stock a déjà bougé au quai. Ici on écrit l'ARGENT : le fournisseur, le
 * total de la facture, l'échéance — et la référence `REC-…` naît au passage.
 *
 * LE RAPPROCHEMENT EST LE CONTRÔLE. Une deuxième signature ne crée pas de
 * preuve : elle crée un deuxième nom sous le même chiffre non vérifié. On
 * compare donc deux sources INDÉPENDANTES — ce que l'agent a compté à l'aveugle
 * sur le quai, et ce que le fournisseur réclame par écrit. Un écart ne se note
 * pas dans une case de texte libre que personne ne remplit : il se tranche, et
 * chaque choix porte sa conséquence chiffrée.
 *
 * ET LE SYSTÈME EXPLIQUE L'ÉCART QUAND IL PEUT. Il connaît `damaged_qty` et il
 * connaît le prix : quand `Σ(abîmées × prix)` tombe exactement sur le trou, la
 * cause est proposée plutôt que demandée. C'est aussi ce qui donne enfin un
 * USAGE à l'avarie, qui n'était jusqu'ici qu'un nombre que rien ne lisait.
 */

const MONEY_EPSILON = 0.0005;
const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Supplier {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
}

export function ReceptionSettleDialog({
  reception,
  currency,
  onClose,
  onSettled,
}: {
  reception: ProjectedReception;
  currency: string;
  onClose: () => void;
  onSettled: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const [supplierId, setSupplierId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers } = useSWR<{ suppliers: Supplier[] }>(
    `/api/suppliers?market_id=${reception.market_id}`,
    fetcher,
  );

  const nf = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

  /** Ce que la marchandise vaut au prix saisi — frais d'approche EXCLUS. */
  const goods = reception.totals.value ?? 0;

  const typed = Number.parseFloat(invoice.replace(/\s/g, "").replace(",", "."));
  const hasInvoice = Number.isFinite(typed);
  const gap = hasInvoice ? Number((typed - goods).toFixed(3)) : 0;
  const reconciled = !hasInvoice || Math.abs(gap) < MONEY_EPSILON;

  /*
   * LA CAUSE QUE LE SYSTÈME PEUT PROUVER. Si le trou vaut exactement les unités
   * abîmées à leur prix, c'est qu'elles sont facturées — et elles ne sont jamais
   * entrées en stock, parce qu'elles n'étaient pas vendables et ne sont pas à
   * nous.
   */
  const damagedValue = useMemo(
    () =>
      reception.lines.reduce(
        (a, l) => a + (l.damaged_qty ?? 0) * (l.unit_cost ?? 0),
        0,
      ),
    [reception.lines],
  );
  const damagedUnits = reception.lines.reduce((a, l) => a + (l.damaged_qty ?? 0), 0);
  const explained =
    !reconciled && damagedUnits > 0 && Math.abs(gap - damagedValue) < MONEY_EPSILON;

  const costLines = reception.lines.filter(
    (l) => l.cogs_next !== null && l.cogs_next !== undefined && (l.received_qty ?? 0) > 0,
  );
  const moving = costLines.filter(
    (l) => Math.abs((l.cogs_next as number) - (l.cogs_current ?? 0)) >= MONEY_EPSILON,
  );

  /**
   * LA FACTURE GARDE LE CHIFFRE DU FOURNISSEUR, ET LE LITIGE PORTE CE QU'ON
   * REFUSE DE PAYER.
   *
   * On envoyait ici la valeur marchandise à la place du total facturé, ce qui
   * rangeait dans `invoice_total` un chiffre figurant sur AUCUN document — et
   * obligeait ensuite chaque écran à devenir lequel des deux il lisait. Le
   * montant retenu se soustrait du solde (voir src/lib/purchases/claims.ts),
   * donc rien n'est perdu et tout reste rattachable à une pièce.
   */
  async function settle(opts: {
    amount: number | null;
    reason: string | null;
    claim?: number | null;
  }) {
    if (busy || !supplierId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${reception.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          invoice_total: opts.amount,
          due_at: dueAt || null,
          discrepancy_reason: opts.reason,
          claim_amount: opts.claim ?? null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return;
      }
      onSettled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(26,26,26,.34)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settleTitle")}
        className="max-h-[92vh] w-full max-w-[560px] overflow-auto rounded-[14px] bg-wh-surface shadow-[0_12px_40px_rgba(26,26,26,.16)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-wh-border px-5 py-4">
          <div>
            <h3 className="text-[16px] font-bold">{t("settleTitle")}</h3>
            <p className="mt-0.5 text-[12.5px] text-wh-ink-3">
              {reception.warehouse_name}
              {reception.arrival_date ? ` · ${reception.arrival_date}` : ""}
            </p>
          </div>
        </header>

        <div className="px-5 py-4">
          {/* ── 1 · D'où ça vient ─────────────────────────────────────────── */}
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
              {t("fieldSupplier")}
            </span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="min-h-[42px] w-full rounded-[10px] border border-wh-border-strong px-3 text-[13.5px]"
            >
              <option value="">{t("settlePickSupplier")}</option>
              {(suppliers?.suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
                {t("settleInvoiceTotal")}
              </span>
              <input
                inputMode="decimal"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                placeholder="—"
                className="min-h-[42px] w-full rounded-[10px] border border-wh-border-strong px-3 text-end font-mono text-[14px] tabular-nums"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-wh-ink-3">
                {t("settleDueAt")}
              </span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="min-h-[42px] w-full rounded-[10px] border border-wh-border-strong px-3 text-[13.5px]"
              />
            </label>
          </div>

          {/* ── 2 · Le rapprochement ──────────────────────────────────────── */}
          <div className="mt-4 overflow-hidden rounded-[10px] border border-wh-border">
            <Line k={t("settleCounted")} v={nf.format(goods)} />
            {hasInvoice ? <Line k={t("settleInvoice")} v={nf.format(typed)} /> : null}
            {!reconciled ? (
              <div className="flex items-center justify-between gap-3 bg-wh-bad-bg px-3.5 py-2.5">
                <span className="text-[13px] font-bold text-wh-bad">{t("settleGap")}</span>
                <span className="font-mono text-[16px] font-bold tabular-nums text-wh-bad">
                  {gap > 0 ? "+" : "−"}
                  {nf.format(Math.abs(gap))}
                </span>
              </div>
            ) : null}
          </div>

          {reconciled ? (
            hasInvoice ? (
              <p className="mt-2.5 flex items-center gap-2 rounded-[8px] border border-wh-ok-edge bg-wh-ok-tint px-3 py-2 text-[12.5px] font-semibold text-wh-ok">
                <Check size={15} strokeWidth={2.6} />
                {t("settleReconciled")}
              </p>
            ) : (
              <p className="mt-2.5 text-[12px] text-wh-ink-3">{t("settleNoInvoiceHint")}</p>
            )
          ) : (
            <>
              {explained ? (
                <p className="mt-2.5 rounded-[8px] border border-wh-ok-edge bg-wh-ok-tint px-3 py-2.5 text-[12.5px] text-wh-ink-2">
                  <span className="font-semibold text-wh-ink-1">
                    {t("settleFound", { count: damagedUnits })}
                  </span>{" "}
                  {t("settleFoundHint")}
                </p>
              ) : (
                <p className="mt-2.5 rounded-[8px] border border-wh-warn-edge bg-wh-warn-bg px-3 py-2.5 text-[12.5px] text-wh-warn">
                  {t("settleUnexplained")}
                </p>
              )}

              {/* DEUX CHOIX, CHACUN AVEC SA CONSÉQUENCE CHIFFRÉE. */}
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy || !supplierId}
                  onClick={() =>
                    void settle({
                      amount: typed,
                      reason: explained ? "damaged_billed" : "claim",
                      // On ne réclame que du SURPLUS facturé. Si la facture est
                      // plus BASSE que le compte (écart négatif), il n'y a rien
                      // à réclamer — c'est une remise, ou une erreur en notre
                      // faveur, et dans les deux cas on ne la contestera pas.
                      claim: gap > 0 ? gap : null,
                    })
                  }
                  className="rounded-[12px] border border-wh-ok bg-wh-ok-tint p-3.5 text-start disabled:opacity-50"
                >
                  <span className="block text-[14px] font-bold">
                    {t("settleClaim", { amount: nf.format(Math.abs(gap)) })}
                  </span>
                  <span className="mt-1 block text-[12.5px] text-wh-ink-2">
                    {t("settleClaimHint", {
                      invoice: nf.format(typed),
                      amount: nf.format(Math.abs(gap)),
                      net: nf.format(goods),
                    })}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy || !supplierId}
                  onClick={() => void settle({ amount: typed, reason: "accepted" })}
                  className="rounded-[12px] border border-wh-border-strong bg-wh-surface p-3.5 text-start disabled:opacity-50"
                >
                  <span className="block text-[14px] font-bold">{t("settleAccept")}</span>
                  <span className="mt-1 block text-[12.5px] text-wh-ink-2">
                    {t("settleAcceptHint", { amount: nf.format(typed) })}
                  </span>
                </button>
              </div>
            </>
          )}

          {/* ── 3 · Ce que ça écrira dans les coûts ───────────────────────── */}
          {moving.length > 0 ? (
            <div className="mt-4 overflow-hidden rounded-[8px] border border-wh-border">
              <div className="border-b border-wh-border bg-wh-sunken px-3.5 py-2.5">
                <span className="block text-[13px] font-semibold">{t("costsWillMove")}</span>
                <span className="mt-0.5 block text-[12px] text-wh-ink-2">
                  {t("costsWillMoveCount", { count: moving.length })}
                </span>
              </div>
              {moving.map((l) => (
                <div
                  key={l.id}
                  className="grid grid-cols-[1fr_80px_18px_80px] items-center gap-x-2 border-b border-wh-border px-3.5 py-2 last:border-b-0"
                >
                  <span className="truncate text-[12.5px] font-medium" dir="auto">
                    {l.product_name}
                  </span>
                  <span className="text-end font-mono text-[12.5px] text-wh-ink-3 line-through tabular-nums">
                    {nf.format(l.cogs_current ?? 0)}
                  </span>
                  <ArrowRight size={12} className="text-wh-ink-3 rtl:-scale-x-100" />
                  <span className="text-end font-mono text-[13px] font-bold tabular-nums">
                    {nf.format(l.cogs_next as number)}
                  </span>
                </div>
              ))}
              {/* LES INCHANGÉS SE COMPTENT, ILS NE SE LISTENT PAS. « 40,000 →
                  40,000 » répété cacherait les deux vrais changements ; les
                  taire complètement laisserait croire qu'on les a oubliés. */}
              {costLines.length - moving.length > 0 ? (
                <p className="flex items-center gap-2 border-t border-wh-border px-3.5 py-2.5 text-[12.5px] text-wh-ink-3">
                  <Check size={14} strokeWidth={2} className="flex-none" />
                  {t("costsUnchangedCount", { count: costLines.length - moving.length })}
                </p>
              ) : null}
              <p className="flex gap-2 border-t border-wh-warn-edge bg-wh-warn-bg px-3.5 py-2.5 text-[12px] text-wh-warn">
                <AlertTriangle size={15} className="mt-px flex-none" />
                {t("costsPolicyWarning")}
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-[6px] border border-wh-bad-edge bg-wh-bad-bg px-3 py-2 text-[13px] font-medium text-wh-bad">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap justify-end gap-2.5 border-t border-wh-border bg-wh-sunken px-5 py-3.5">
          <button type="button" className={WH_BTN} onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          {/* Le bouton direct n'existe QUE si le rapprochement tombe juste : sinon
              le choix est au-dessus, et il est explicite. */}
          {reconciled ? (
            <button
              type="button"
              className={WH_BTN_PRIMARY}
              disabled={busy || !supplierId}
              onClick={() => void settle({ amount: hasInvoice ? typed : null, reason: null })}
            >
              <Check size={17} strokeWidth={2.2} />
              {t("settle")}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-wh-border px-3.5 py-2.5 last:border-b-0">
      <span className="text-[13px] text-wh-ink-2">{k}</span>
      <span className="font-mono text-[15px] font-semibold tabular-nums">{v}</span>
    </div>
  );
}
