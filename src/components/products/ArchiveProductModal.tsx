"use client";

import React, { useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Archive, AlertTriangle } from "lucide-react";
import type FocusTrapType from "focus-trap-react";

const FocusTrap = dynamic(() => import("focus-trap-react"), { ssr: false }) as typeof FocusTrapType;

export interface ArchiveProductState {
  productId: string;
  productName: string;
  loading: boolean;
  error: string | null;
}

interface Props {
  state: ArchiveProductState;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation d'archivage.
 *
 * ── POURQUOI UNE CONFIRMATION, ET POURQUOI PAS PLUS ───────────────────────
 * L'archivage retire le produit de la liste, de la recherche, du sélecteur de
 * création de commande et des mappings. La liste n'offre aucune annulation :
 * une fois archivé, seul un super_admin peut le restaurer via restore_product.
 * Une confirmation nommée est donc le minimum.
 *
 * Elle ne demande PAS de retaper le nom du produit. Le geste est déjà en deux
 * temps — il faut avoir désactivé le produit avant que l'entrée n'apparaisse —
 * et rien n'est détruit : commandes, journal d'inventaire et états investisseur
 * restent intacts. Exiger une saisie ferait payer un rituel de suppression
 * définitive à une action qui n'en est pas une.
 */
export function ArchiveProductModal({ state, onConfirm, onClose }: Props) {
  const t = useTranslations("products");

  const handleClose = useCallback(() => {
    if (!state.loading) onClose();
  }, [state.loading, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={handleClose}
        aria-hidden="true"
      />
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-title"
          aria-describedby="archive-body"
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,470px)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line-subtle bg-surface-card p-[22px_24px] shadow-floating"
        >
          <div className="flex items-start gap-3.5">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-[12px] bg-status-criticalBg text-status-critical">
              <Archive size={18} strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2
                id="archive-title"
                className="m-0 text-[16.5px] font-semibold tracking-[-0.016em] text-ink-primary"
              >
                {t("archiveModal.title")}
              </h2>
              <p
                id="archive-body"
                className="mt-2 text-[13px] leading-relaxed text-ink-secondary"
              >
                {t.rich("archiveModal.body", {
                  name: state.productName,
                  strong: (chunks) => (
                    <strong dir="auto" className="font-semibold text-ink-primary">
                      {chunks}
                    </strong>
                  ),
                })}
              </p>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
                {t("archiveModal.historyKept")}
              </p>
            </div>
          </div>

          {state.error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-[10px] border border-status-critical/30 bg-status-criticalBg px-3.5 py-2.5 text-[12.5px] text-status-critical"
            >
              <AlertTriangle size={14} strokeWidth={2} aria-hidden className="mt-px flex-none" />
              {state.error}
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              disabled={state.loading}
              className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface-card px-4 text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("archiveModal.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={state.loading}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-status-critical px-4 text-[13.5px] font-semibold text-white transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state.loading ? t("archiveModal.pending") : t("archiveModal.confirm")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}
