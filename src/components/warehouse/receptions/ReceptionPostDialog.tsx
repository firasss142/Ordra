"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X, AlertTriangle, ArrowRight, Check } from "lucide-react";
import type { ProjectedReception } from "@/lib/receptions/project";
import { WH_LABEL, WH_BTN, WH_BTN_PRIMARY } from "@/components/warehouse/console/tokens";

/**
 * Valider — le seul geste qui fait exister le stock, et le seul endroit de
 * l'application où un geste d'entrepôt peut recalculer le P&L.
 *
 * LA CASE EST DÉCOCHÉE PAR DÉFAUT, ET ELLE MONTRE SON ARITHMÉTIQUE.
 * `products.unit_cogs` est un scalaire COURANT que le P&L (fenêtré sur
 * événements) et `investor_order_facts` lisent en direct : l'écrire recalcule
 * la marge des commandes DÉJÀ LIVRÉES. Montrer « 75,000 → 74,667 » produit par
 * produit avant d'appliquer est ce qui rend le choix honnête, et le serveur
 * est désormais gouverné par le réglage `costing_update_on_settle` du marché,
 * lu par la RPC. Cette boîte ne décide plus : elle MONTRE ce qui va se passer.
 *
 * Un coût INCHANGÉ s'affiche en gris SANS rature : barrer « 40,000 → 40,000 »
 * suggérerait un changement qui n'a pas lieu.
 */
export function ReceptionPostDialog({
  reception,
  currency,
  onClose,
  onPosted,
}: {
  reception: ProjectedReception;
  currency: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const cf = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

  // Seules les lignes qui portent un coût ET qui entrent en stock peuvent
  // déplacer un coût catalogue.
  const costLines = reception.lines.filter(
    (l) =>
      l.unit_cost !== null &&
      l.unit_cost !== undefined &&
      l.cogs_next !== null &&
      l.cogs_next !== undefined &&
      (l.received_qty ?? 0) > 0,
  );

  /*
   * SEULS LES COÛTS QUI BOUGENT SONT LISTÉS.
   *
   * Afficher « 40,000 → 40,000 » est du bruit qui rend les vrais changements plus
   * difficiles à voir — et c'est précisément cette boîte qui doit rendre la case
   * à cocher honnête. Un coût inchangé reste un fait, mais il se COMPTE.
   *
   * Le seuil est celui de la base : `unit_cogs` est au millième, donc on compare
   * à la demi-unité de ce grain pour qu'un aller-retour en flottant ne fabrique
   * pas un changement de 0,0000001.
   */
  const moving = costLines.filter(
    (l) => Math.abs((l.cogs_next as number) - (l.cogs_current ?? 0)) >= 0.0005,
  );
  const unchanged = costLines.length - moving.length;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${reception.id}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
         * PLUS AUCUN DRAPEAU DE COÛT. Mettre à jour `unit_cogs` est une
         * politique comptable, lue par la RPC dans le réglage du marché — pas
         * une case cochée ici par celui qui valide, à 23 h, sur un quai.
         */
        body: "{}",
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return;
      }
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[rgba(21,26,31,.5)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("postTitle", { reference: reception.reference })}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="w-full max-w-[560px] overflow-hidden rounded-[12px] bg-wh-surface shadow-[0_8px_32px_rgba(16,24,40,.18)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-wh-border px-5 py-4">
          <h3 className="text-[16px] font-bold">
            {t("postTitle", { reference: reception.reference })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="text-wh-ink-2 hover:text-wh-ink-1"
          >
            <X size={17} />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[13.5px] text-wh-ink-2">
            {t("postIntro", {
              units: nf.format(reception.totals.units),
              site: reception.warehouse_name ?? "—",
            })}
          </p>

          <div className="mt-3.5 grid grid-cols-3 gap-px overflow-hidden rounded-[8px] border border-wh-border bg-wh-border">
            <Cell label={t("totalUnits")}>{nf.format(reception.totals.units)}</Cell>
            <Cell label={t("totalDamaged")} tone={reception.totals.damaged > 0 ? "warn" : undefined}>
              {nf.format(reception.totals.damaged)}
            </Cell>
            <Cell label={t("totalValue")}>
              {reception.totals.value === null ? "—" : nf.format(reception.totals.value)}
            </Cell>
          </div>

          {/*
           * Si AUCUN coût ne bouge, la case n'a pas d'objet : la montrer
           * proposerait une décision sans conséquence, et la décocher par prudence
           * n'aurait rien évité.
           */}
          {moving.length > 0 ? (
            <>
              <div className="mt-4 overflow-hidden rounded-[8px] border border-wh-border">
                {/*
                  * UNE CONSÉQUENCE, PAS UNE QUESTION. L'ancienne version posait
                  * la question ici, case décochée : la base de coût de
                  * l'entreprise devenait fonction de l'attention de quelqu'un.
                  */}
                <div className="border-b border-wh-border bg-wh-sunken px-3.5 py-3">
                  <span className="block text-[13.5px] font-semibold">{t("costsWillMove")}</span>
                  <span className="mt-0.5 block text-[12px] text-wh-ink-2">
                    {t("costsWillMoveCount", { count: moving.length })}
                  </span>
                </div>

                {moving.map((l) => {
                  const before = l.cogs_current ?? 0;
                  const after = l.cogs_next as number;
                  return (
                    <div
                      key={l.id}
                      className="grid grid-cols-[1fr_84px_20px_84px] items-center gap-x-2.5 border-b border-wh-border px-3.5 py-2.5 last:border-b-0"
                    >
                      <span className="truncate text-[13px] font-medium" dir="auto">
                        {l.product_name}
                      </span>
                      {/* Barré, parce qu'il est réellement remplacé. */}
                      <span className="text-end font-mono text-[13px] tabular-nums text-wh-ink-3 line-through">
                        {cf.format(before)}
                      </span>
                      <span className="grid place-items-center text-wh-ink-3">
                        <ArrowRight size={13} className="rtl:-scale-x-100" />
                      </span>
                      <span
                        className={`text-end font-mono text-[13.5px] font-bold tabular-nums ${
                          after > before ? "text-wh-bad" : "text-wh-ok"
                        }`}
                      >
                        {cf.format(after)}
                      </span>
                    </div>
                  );
                })}

                {/* Les inchangés se comptent ; ils n'ont pas besoin d'une ligne. */}
                {unchanged > 0 ? (
                  <p className="flex items-center gap-2 border-t border-wh-border px-3.5 py-2.5 text-[12.5px] text-wh-ink-3">
                    <Check size={14} strokeWidth={2} className="flex-none" />
                    {t("costsUnchangedCount", { count: unchanged })}
                  </p>
                ) : null}
              </div>

              <div className="mt-3.5 flex gap-2.5 rounded-[8px] border border-wh-warn-edge bg-wh-warn-bg px-3.5 py-3">
                <AlertTriangle size={17} className="mt-px flex-none text-wh-warn" strokeWidth={2.2} />
                <p className="text-[12.5px] text-wh-warn">{t("costsPolicyWarning")}</p>
              </div>
            </>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-[6px] border border-wh-bad-edge bg-wh-bad-bg px-3 py-2 text-[13px] font-medium text-wh-bad">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-wh-border bg-wh-sunken px-5 py-3.5">
          <button type="button" className={WH_BTN} onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button type="button" className={WH_BTN_PRIMARY} onClick={() => void submit()} disabled={busy}>
            {t("post")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Cell({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <div className="bg-wh-surface px-3.5 py-3">
      <div className={WH_LABEL}>{label}</div>
      <div
        className={`mt-1 font-mono text-[17px] font-semibold tabular-nums ${
          tone === "warn" ? "text-wh-warn" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
