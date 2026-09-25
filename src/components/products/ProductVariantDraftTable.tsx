"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CONTROL, cx } from "./form-chrome";

/**
 * The sizes of a product that does not exist yet.
 *
 * WRITES NOTHING. This table is controlled: the create form owns the state and
 * sends ONE request at the end, which creates the product and its variants
 * server-side. Creating them one by one from the browser would multiply the
 * failure windows — a product created, two variants of three, and nothing to
 * say where it stopped.
 *
 * Values are kept as STRINGS, deliberately. A half-typed "12." is not a number
 * and coercing on every keystroke fights the person typing; the form parses
 * once, on submit.
 */

export interface VariantDraft {
  /** Stable across re-orders and removals — React keys must not be the index. */
  key: string;
  label: string;
  sku: string;
  unit_cogs: string;
  display_price: string;
  initial_stock: string;
}

export function emptyVariantDraft(): VariantDraft {
  return {
    key:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Math.random()),
    label: "",
    sku: "",
    unit_cogs: "",
    display_price: "",
    initial_stock: "0",
  };
}

interface Props {
  value: VariantDraft[];
  onChange: (next: VariantDraft[]) => void;
  /** markets.currency symbol, for the stock total caption. */
  currencySymbol?: string;
}

const LABEL_CLS = "text-[11.5px] font-medium text-ink-secondary";
const ROW_CLS =
  "flex flex-col gap-3 rounded-xl border border-line-subtle bg-surface-card p-3 " +
  "sm:flex-row sm:items-end sm:gap-2";

export function ProductVariantDraftTable({ value, onChange, currencySymbol }: Props) {
  void currencySymbol; // the stock total is a count, not an amount
  const t = useTranslations("products.create.variants");

  const total = value.reduce((sum, v) => {
    const n = parseInt(v.initial_stock, 10);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  function patch(key: string, field: keyof VariantDraft, next: string) {
    onChange(value.map((v) => (v.key === key ? { ...v, [field]: next } : v)));
  }

  return (
    <div className="flex flex-col gap-3">
      {value.map((v, i) => (
        <div
          key={v.key}
          role="group"
          // Named by what the person typed, so a screen reader (and a test)
          // tells "Grand" from "Petit" without counting rows. Falls back to the
          // position while the name is still empty.
          aria-label={v.label.trim() !== "" ? v.label : `${t("columns.label")} ${i + 1}`}
          className={ROW_CLS}
        >
          <div className="flex-1">
            <label className={LABEL_CLS} htmlFor={`vd-label-${v.key}`}>
              {t("columns.label")}
            </label>
            <input
              id={`vd-label-${v.key}`}
              dir="auto"
              placeholder={t("labelPlaceholder")}
              className={cx(CONTROL, "mt-1 text-start")}
              value={v.label}
              onChange={(e) => patch(v.key, "label", e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[136px]">
            <label className={LABEL_CLS} htmlFor={`vd-sku-${v.key}`}>
              {t("columns.sku")}
            </label>
            <input
              id={`vd-sku-${v.key}`}
              dir="auto"
              placeholder={t("skuPlaceholder")}
              className={cx(CONTROL, "mt-1 text-start")}
              value={v.sku}
              onChange={(e) => patch(v.key, "sku", e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[112px]">
            <label className={LABEL_CLS} htmlFor={`vd-cogs-${v.key}`}>
              {t("columns.unitCogs")}
            </label>
            <input
              id={`vd-cogs-${v.key}`}
              type="number"
              min={0}
              step="0.001"
              className={cx(CONTROL, "mt-1 tabular-nums")}
              value={v.unit_cogs}
              onChange={(e) => patch(v.key, "unit_cogs", e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[112px]">
            <label className={LABEL_CLS} htmlFor={`vd-price-${v.key}`}>
              {t("columns.displayPrice")}
            </label>
            <input
              id={`vd-price-${v.key}`}
              type="number"
              min={0}
              step="0.001"
              className={cx(CONTROL, "mt-1 tabular-nums")}
              value={v.display_price}
              onChange={(e) => patch(v.key, "display_price", e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[104px]">
            <label className={LABEL_CLS} htmlFor={`vd-stock-${v.key}`}>
              {t("columns.initialStock")}
            </label>
            <input
              id={`vd-stock-${v.key}`}
              type="number"
              min={0}
              step="1"
              className={cx(CONTROL, "mt-1 tabular-nums")}
              value={v.initial_stock}
              onChange={(e) => patch(v.key, "initial_stock", e.target.value)}
            />
          </div>

          <div className="pb-0.5">
            <button
              type="button"
              // The last row cannot go: the toggle is what turns variants off,
              // and an empty table with the switch on means nothing.
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((x) => x.key !== v.key))}
              className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-ink-secondary
                         disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("remove")}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...value, emptyVariantDraft()])}
        className="self-start rounded-lg border border-dashed border-line-strong px-3 py-2
                   text-[12.5px] font-medium text-ink-secondary hover:border-prod-brand
                   hover:text-prod-brand"
      >
        {t("add")}
      </button>

      <p className="text-[11.5px] leading-normal text-ink-muted">{t("skuHint")}</p>
      <p className="text-[11.5px] leading-normal text-ink-muted">
        {t("stockFromVariants", { total })}
      </p>
    </div>
  );
}
