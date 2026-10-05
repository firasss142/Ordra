"use client";

import React, { useCallback, useEffect, useId, useRef } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type FocusTrapType from "focus-trap-react";

const FocusTrap = dynamic(() => import("focus-trap-react"), { ssr: false }) as typeof FocusTrapType;

/** One size the correction can target. Pack tiers hold no stock and never appear. */
export interface StockVariantOption {
  id: string;
  label: string;
  current_stock: number;
}

export interface StockAdjustState {
  productId: string;
  productName: string;
  change: string;
  reason: "manual_adjustment" | "damaged_writeoff";
  note: string;
  loading: boolean;
  error: string | null;
  /** The size being corrected; null is "the product as a whole" (the unallocated stock). */
  variantId: string | null;
  variants: StockVariantOption[];
  /** Why the dialog opened, when it opened for a reason (clearing a size before deleting it). */
  hint: string | null;
  /** The caller asked for this size; do not let the picker move off it. */
  lockVariant?: boolean;
}

interface StockAdjustModalProps {
  state: StockAdjustState;
  onChange: (patch: Partial<StockAdjustState>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/*
 * Aurore modal (docs/design-system.md §4.13): scrim .32 + blur 4, a 440px panel
 * with a 22px radius, glass white, header 16/800 with a meta line, actions
 * end-aligned. Written in px — the app's root font is 14px and rem sizes would
 * shrink it by 12.5 %.
 */
const FIELD =
  "h-[40px] w-full rounded-[11px] border border-[rgba(15,23,40,.12)] bg-white px-[12px] text-[14px] font-semibold " +
  "text-[#0F1728] outline-none placeholder:font-medium placeholder:text-[#8A94A6] focus:border-[#15803D] " +
  "focus:shadow-[0_0_0_3px_rgba(21,128,61,.16)] disabled:bg-[rgba(15,23,40,.04)] disabled:text-[#667085]";
const LABEL = "mb-[6px] block text-[12.5px] font-bold text-[#475467]";
const BTN =
  "inline-flex h-[38px] items-center justify-center rounded-[11px] px-[16px] text-[13.5px] font-bold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function StockAdjustModal({ state, onChange, onSubmit, onClose }: StockAdjustModalProps) {
  const t = useTranslations("products");
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

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

  const variant = state.variants.find((v) => v.id === state.variantId) ?? null;
  const change = Number.parseInt(state.change, 10);
  const after = variant && Number.isInteger(change) && change !== 0 ? variant.current_stock + change : null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-[rgba(15,23,40,.32)] backdrop-blur-[4px]"
        onClick={handleClose}
        aria-hidden
      />
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => modalRef.current ?? document.body }}>
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(440px,95vw)] -translate-y-1/2 flex-col gap-[14px] overflow-y-auto
                     rounded-[22px] bg-[rgba(255,255,255,.92)] p-[22px] shadow-[0_20px_52px_rgba(42,52,110,.18)] backdrop-blur-[20px]
                     ltr:-translate-x-1/2 rtl:translate-x-1/2"
        >
          <div>
            <h2 id={titleId} className="m-0 text-[16px] font-extrabold text-[#0F1728]">
              {t("stockModal.title", { name: state.productName })}
            </h2>
            <p className="m-0 mt-[3px] text-[12.5px] font-medium text-[#667085]">{t("stockModal.subtitle")}</p>
          </div>

          {state.hint ? (
            <p className="m-0 rounded-[12px] bg-[#FFF4E0] px-[12px] py-[9px] text-[12.5px] font-semibold leading-[1.45] text-[#B54708]">
              {state.hint}
            </p>
          ) : null}

          {state.variants.length > 0 ? (
            <div>
              <label className={LABEL} htmlFor={`${titleId}-variant`}>
                {t("stockModal.variantLabel")}
              </label>
              <select
                id={`${titleId}-variant`}
                value={state.variantId ?? ""}
                disabled={state.lockVariant || state.loading}
                onChange={(e) => onChange({ variantId: e.target.value === "" ? null : e.target.value })}
                className={FIELD}
              >
                <option value="">{t("stockModal.variantWhole")}</option>
                {state.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t("stockModal.variantOption", { label: v.label, stock: v.current_stock })}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <div className="mb-[6px] flex items-center justify-between gap-[8px]">
              <label className="text-[12.5px] font-bold text-[#475467]" htmlFor={`${titleId}-qty`}>
                {t("stockModal.quantityLabel")}
              </label>
              {variant && variant.current_stock > 0 ? (
                <button
                  type="button"
                  onClick={() => onChange({ change: String(-variant.current_stock) })}
                  className="text-[12.5px] font-bold text-[#15803D] hover:underline"
                >
                  {t("stockModal.zeroOut")}
                </button>
              ) : null}
            </div>
            <input
              id={`${titleId}-qty`}
              type="number"
              value={state.change}
              onChange={(e) => onChange({ change: e.target.value })}
              placeholder={t("stockModal.quantityPlaceholder")}
              className={FIELD}
            />
            {variant ? (
              <p className="m-0 mt-[6px] flex items-center gap-[8px] text-[12.5px] font-medium text-[#667085]">
                <span>{t("stockModal.currentLabel")}</span>
                <span
                  className={`font-extrabold tabular-nums ${after !== null && after < 0 ? "text-[#B42318]" : "text-[#0F1728]"}`}
                  dir="ltr"
                >
                  {after === null ? variant.current_stock : `${variant.current_stock} → ${after}`}
                </span>
              </p>
            ) : null}
          </div>

          <div>
            <label className={LABEL} htmlFor={`${titleId}-reason`}>
              {t("stockModal.reasonLabel")}
            </label>
            <select
              id={`${titleId}-reason`}
              value={state.reason}
              onChange={(e) => onChange({ reason: e.target.value as "manual_adjustment" | "damaged_writeoff" })}
              className={FIELD}
            >
              <option value="manual_adjustment">{t("stockReasons.manual_adjustment")}</option>
              <option value="damaged_writeoff">{t("stockReasons.damaged_writeoff")}</option>
            </select>
          </div>

          <div>
            <label className={LABEL} htmlFor={`${titleId}-note`}>
              {t("stockModal.noteLabel")}
            </label>
            <input
              id={`${titleId}-note`}
              type="text"
              value={state.note}
              onChange={(e) => onChange({ note: e.target.value })}
              placeholder={t("stockModal.notePlaceholder")}
              className={FIELD}
            />
          </div>

          {state.error ? (
            <p role="alert" className="m-0 rounded-[12px] bg-[#FEF3F2] px-[12px] py-[9px] text-[12.5px] font-semibold text-[#B42318]">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-[8px]">
            <button
              type="button"
              onClick={handleClose}
              disabled={state.loading}
              className={`${BTN} border border-[rgba(15,23,40,.12)] bg-white text-[#0F1728] hover:bg-[rgba(15,23,40,.04)]`}
            >
              {t("stockModal.cancel")}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={state.loading}
              className={`${BTN} bg-[#15803D] text-white hover:bg-[#12692F]`}
            >
              {state.loading ? t("stockModal.saving") : t("stockModal.apply")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}
