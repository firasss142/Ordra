"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X, AlertTriangle, ArrowRight } from "lucide-react";
import type { ProjectedReception } from "@/lib/receptions/project";
import { WH_LABEL, WH_BTN, WH_BTN_PRIMARY } from "@/components/warehouse/console/tokens";

/**
 * Valider — le seul geste qui fait exister le stock, et le seul endroit de
 * l'application où un geste d'entrepôt peut recalculer le P&L.
 *
 * LA CASE EST DÉCOCHÉE PAR DÉFAUT, ET ELLE MONTRE SON ARITHMÉTIQUE.
 * `products.unit_cogs` est un scalaire COURANT que le P&L (fenêtré sur
 * événements) et `investor_order_facts` lisent en direct : l'adopter recalcule
 * la marge des commandes DÉJÀ LIVRÉES. Montrer « 75,000 → 74,667 » produit par
 * produit avant d'appliquer est ce qui rend le choix honnête, et le serveur
 * exige `adopt_costs === true` strictement.
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
  const [adopt, setAdopt] = useState(false);
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

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${reception.id}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `true` strict, jamais une valeur vaguement vraie.
        body: JSON.stringify({ adopt_costs: adopt === true }),
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

          {costLines.length > 0 ? (
            <>
              <div className="mt-4 overflow-hidden rounded-[8px] border border-wh-border">
                <label className="flex cursor-pointer items-start gap-3 border-b border-wh-border bg-wh-sunken px-3.5 py-3">
                  <input
                    type="checkbox"
                    checked={adopt}
                    onChange={(e) => setAdopt(e.target.checked)}
                    className="mt-0.5 h-[17px] w-[17px] flex-none accent-wh-ok"
                  />
                  <span>
                    <span className="block text-[13.5px] font-semibold">{t("adoptCosts")}</span>
                    <span className="mt-0.5 block text-[12px] text-wh-ink-2">
                      {t("adoptCostsHint")}
                    </span>
                  </span>
                </label>

                {costLines.map((l) => {
                  const before = l.cogs_current ?? 0;
                  const after = l.cogs_next as number;
                  const moves = Math.abs(after - before) >= 0.0005;
                  return (
                    <div
                      key={l.id}
                      className="grid grid-cols-[1fr_84px_20px_84px] items-center gap-x-2.5 border-b border-wh-border px-3.5 py-2.5 last:border-b-0"
                    >
                      <span className="truncate text-[13px] font-medium" dir="auto">
                        {l.product_name}
                      </span>
                      <span
                        className={`text-end font-mono text-[13px] tabular-nums text-wh-ink-3 ${
                          moves ? "line-through" : ""
                        }`}
                      >
                        {cf.format(before)}
                      </span>
                      <span className="grid place-items-center text-wh-ink-3">
                        <ArrowRight size={13} className="rtl:-scale-x-100" />
                      </span>
                      <span
                        className={`text-end font-mono text-[13.5px] tabular-nums ${
                          !moves
                            ? "font-medium text-wh-ink-3"
                            : after > before
                              ? "font-bold text-wh-bad"
                              : "font-bold text-wh-ok"
                        }`}
                      >
                        {cf.format(after)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3.5 flex gap-2.5 rounded-[8px] border border-wh-warn-edge bg-wh-warn-bg px-3.5 py-3">
                <AlertTriangle size={17} className="mt-px flex-none text-wh-warn" strokeWidth={2.2} />
                <p className="text-[12.5px] text-wh-warn">{t("adoptCostsWarning")}</p>
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
