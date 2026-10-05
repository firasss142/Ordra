"use client";

// One stock correction, from "open the dialog" to "the ledger line is written".
// Shared by the product list / sheet (useProductActions) and the variants
// editor, so that a size can be corrected from either place the same way.

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  StockAdjustModal,
  type StockAdjustState,
  type StockVariantOption,
} from "@/components/products/StockAdjustModal";

export interface OpenStockOptions {
  /** The sizes on offer. Omitted → fetched from the product's variants route. */
  variants?: StockVariantOption[];
  variantId?: string | null;
  /** Pre-filled quantity (negative to withdraw). */
  change?: number;
  note?: string;
  hint?: string | null;
  lockVariant?: boolean;
}

interface VariantRow {
  id: string;
  kind: string;
  label: string;
  current_stock: number;
  is_active: boolean;
}

export function useStockAdjust(onDone: (done: StockAdjustState) => void | Promise<unknown>) {
  const t = useTranslations("products");
  const [stock, setStock] = useState<StockAdjustState | null>(null);

  const openStock = useCallback(
    (productId: string, productName: string, opts: OpenStockOptions = {}) => {
      setStock({
        productId,
        productName,
        change: opts.change === undefined ? "" : String(opts.change),
        reason: "manual_adjustment",
        note: opts.note ?? "",
        loading: false,
        error: null,
        variantId: opts.variantId ?? null,
        variants: opts.variants ?? [],
        hint: opts.hint ?? null,
        lockVariant: opts.lockVariant,
      });
      if (opts.variants) return;

      // The product list does not know the sizes; ask, but never hold the dialog
      // up for it — a product with none, or a failed read, is just the plain form.
      void (async () => {
        try {
          const res = await fetch(`/api/products/${productId}/variants`);
          if (!res.ok) return;
          const body = (await res.json()) as { data?: VariantRow[] };
          const sizes = (body.data ?? [])
            .filter((v) => v.kind === "attribute" && v.is_active)
            .map((v) => ({ id: v.id, label: v.label, current_stock: Number(v.current_stock ?? 0) }));
          setStock((s) => (s && s.productId === productId ? { ...s, variants: sizes } : s));
        } catch {
          /* plain form */
        }
      })();
    },
    [],
  );

  const submit = useCallback(async () => {
    if (!stock) return;
    const change = Number.parseInt(stock.change, 10);
    if (!Number.isInteger(change) || change === 0) {
      setStock((s) => s && { ...s, error: t("stockModal.errorQuantity") });
      return;
    }
    if (!stock.note.trim()) {
      setStock((s) => s && { ...s, error: t("stockModal.errorNote") });
      return;
    }
    setStock((s) => s && { ...s, loading: true, error: null });
    const res = await fetch(`/api/products/${stock.productId}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        change,
        reason: stock.reason,
        note: stock.note.trim(),
        ...(stock.variantId ? { variant_id: stock.variantId } : {}),
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      const error =
        res.status === 403
          ? t("stockModal.errorForbidden")
          : (json.error ?? t("errors.generic", { status: res.status }));
      setStock((s) => s && { ...s, loading: false, error });
      return;
    }
    const done = stock;
    setStock(null);
    await onDone(done);
  }, [stock, onDone, t]);

  const modal = stock ? (
    <StockAdjustModal
      state={stock}
      onChange={(patch) => setStock((s) => s && { ...s, ...patch })}
      onSubmit={() => void submit()}
      onClose={() => setStock((s) => (s && !s.loading ? null : s))}
    />
  ) : null;

  return { openStock, modal };
}
