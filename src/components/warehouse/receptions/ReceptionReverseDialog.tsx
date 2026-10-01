"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X, AlertTriangle } from "lucide-react";
import type { ProjectedReception } from "@/lib/receptions/project";
import { WH_LABEL, WH_BTN } from "@/components/warehouse/console/tokens";

/**
 * Contre-passer une réception validée.
 *
 * ON AJOUTE L'INVERSE, ON N'EFFACE PAS. `inventory_log` est en écriture seule
 * par déclencheur : une réception validée par erreur ne se modifie pas et ne se
 * supprime pas, elle se corrige par une seconde réception de signe opposé. Deux
 * lignes de registre restent donc pour toujours, et c'est le but — l'histoire de
 * l'erreur fait partie de l'histoire du stock.
 *
 * `reverse_reception` REFUSE AVANT TOUTE ÉCRITURE si les unités sont déjà
 * parties. Réécrire l'histoire n'est pas la réponse quand la marchandise est
 * chez le client : un comptage l'est. Le message d'erreur de la RPC est donc
 * affiché tel quel, puisqu'il nomme précisément ce qui manque.
 */
export function ReceptionReverseDialog({
  reception,
  onClose,
  onReversed,
}: {
  reception: ProjectedReception;
  onClose: () => void;
  onReversed: () => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const [note, setNote] = useState("");
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

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receptions/${reception.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || null }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return;
      }
      onReversed();
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
      aria-label={t("reverseTitle", { reference: reception.reference })}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="w-full max-w-[560px] overflow-hidden rounded-[12px] bg-wh-surface shadow-[0_8px_32px_rgba(16,24,40,.18)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-wh-border px-5 py-4">
          <h3 className="text-[16px] font-bold">
            {t("reverseTitle", { reference: reception.reference })}
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
          <p className="text-[13.5px] text-wh-ink-2">{t("reverseIntro")}</p>

          <div className="mt-3.5 flex gap-2.5 rounded-[8px] border border-wh-bad-edge bg-wh-bad-bg px-3.5 py-3">
            <AlertTriangle size={17} className="mt-px flex-none text-wh-bad" strokeWidth={2.2} />
            <p className="text-[12.5px] text-wh-bad">
              {t("postIntro", {
                units: nf.format(reception.totals.units),
                site: reception.warehouse_name ?? "—",
              })}
            </p>
          </div>

          <label className="mt-3.5 block">
            <span className={WH_LABEL}>{t("reverseNote")}</span>
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              /*
               * Laissé vide, c'est la RPC qui écrit son propre motif en nommant
               * la réception d'origine. L'indice montre donc ce qui sera écrit si
               * on ne dit rien, au lieu de laisser croire que le champ est requis.
               */
              placeholder={t("reversalOf", { reference: reception.reference })}
              dir="auto"
              className="mt-1.5 w-full rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px]"
            />
          </label>

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
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-[10px] border border-wh-bad bg-wh-bad px-[15px] py-[9px] text-[13.5px] font-semibold text-white disabled:opacity-45"
            onClick={() => void submit()}
            disabled={busy}
          >
            {t("reverse")}
          </button>
        </div>
      </div>
    </div>
  );
}
