"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Pencil, X } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { StepperField } from "@/components/ui/StepperField";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { stockBadge } from "@/lib/products/stock-badge";
import type { OrderItem } from "./types";

interface ProductLite {
  id: string;
  current_stock: number;
  image_url?: string | null;
  product_variants: { id: string; label: string; is_active: boolean }[];
}

export interface OrderItemsCardProps {
  items: OrderItem[];
  /** Current top-level product (for variant options). */
  currentProductId: string | null;
  /** All products fetched for this market — used to compute stock per line. */
  products: ProductLite[];
  /** Cached variant options for the current product (active only). */
  variantOptions: { id: string; label: string; is_active: boolean }[];
  loadProducts: (query: string) => Promise<ComboboxOption[]>;
  deliveryFee: number;
  cardPayment: boolean;
  grandTotal: number;
  displayCurrency: string;
  canEdit: boolean;
  isLibyaOrder: boolean;
  saveError: string | null;
  onCommitLegacyProduct: (productId: string) => void;
  onCommitLegacyQuantity: (qty: number) => void;
  onCommitLegacyPrice: (price: number) => void;
  onCommitLegacyVariant: (variantId: string) => void;
  onPatchItem: (itemId: string, body: Record<string, unknown>) => void;
  onDeleteItem: (itemId: string) => void;
  onCommitDeliveryFee: (v: number) => void;
  /** Opens the agent product sheet for a given line's product. */
  onOpenProductSheet?: (productId: string | null) => void;
  /** Slot for the "+ add product" affordance — supplied by parent. */
  renderAddProduct?: () => ReactNode;
}

/**
 * The receipt: what was ordered, and what it comes to.
 *
 * The card chrome and the collapse are gone — the tab is the disclosure, and
 * a collapsed card meant opening a panel to check a receipt, then clicking
 * again to actually see it.
 *
 * The total is broken down rather than asserted. Sub-total and delivery are
 * quiet; the grand total is stated exactly as the table's Total column and the
 * facts grid state it, so one order never reads as two different amounts.
 */
export function OrderItemsCard({
  items,
  products,
  variantOptions,
  loadProducts,
  deliveryFee,
  cardPayment,
  grandTotal,
  displayCurrency,
  canEdit,
  isLibyaOrder,
  saveError,
  onCommitLegacyProduct,
  onCommitLegacyQuantity,
  onCommitLegacyPrice,
  onCommitLegacyVariant,
  onPatchItem,
  onDeleteItem,
  onCommitDeliveryFee,
  onOpenProductSheet,
  renderAddProduct,
}: OrderItemsCardProps) {
  const t = useTranslations("orders.detail");
  const tSheet = useTranslations("productSheet");

  const subtotal = items.reduce((sum, it) => sum + (Number(it.line_total) || 0), 0);

  return (
    <div className="flex flex-col">
      {items.map((item, idx) => {
        const itemProduct = products.find((p) => p.id === item.product_id) ?? null;
        const stock = itemProduct?.current_stock ?? null;
        const badge = stock !== null ? stockBadge(stock) : null;
        const stockLabel = badge
          ? t(badge.key, badge.count !== undefined ? { count: badge.count } : undefined)
          : "";
        // Colour carries urgency; the label carries the fact. Never one alone.
        const stockTone =
          badge?.tone === "critical"
            ? "text-oms-bad"
            : badge?.tone === "warning"
              ? "text-oms-warn"
              : "text-oms-ok";

        // Editable values wear a dotted underline at rest. The pencil-on-hover
        // alone was undiscoverable: you had to already suspect a field was
        // editable in order to find out that it was.
        const editableText = canEdit
          ? "underline decoration-dotted decoration-oms-border-strong underline-offset-[3px]"
          : "";

        return (
          <div
            key={item.id}
            className="group border-b border-oms-border py-3 first:pt-0 last:border-0"
          >
            <div className="flex items-start gap-3">
              <ProductAvatar
                imageUrl={itemProduct?.image_url ?? null}
                productName={item.product_name}
                size={46}
              />

              <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                {/* Name owns its line. It used to share one with the price and
                    the sheet icon, which truncated Arabic names at ~28 chars. */}
                <div className="flex min-w-0 items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <Combobox
                      value={item.product_name}
                      options={[]}
                      loadOptions={loadProducts}
                      onCommit={(productId) => {
                        if (item.id === "legacy") {
                          onCommitLegacyProduct(productId);
                        } else {
                          onPatchItem(item.id, { product_id: productId });
                        }
                      }}
                      placeholder={t("pickProduct")}
                      displayMode
                      readOnly={!canEdit}
                      displayClassName={`text-[14px] font-semibold leading-[1.35] text-oms-ink-1 ${editableText}`}
                    />
                  </div>

                  {/* Actions sit next to the name, not in the money column —
                      an icon must never push an amount off the spine. */}
                  {onOpenProductSheet && (
                    <button
                      type="button"
                      onClick={() => onOpenProductSheet(item.product_id)}
                      title={tSheet("open")}
                      aria-label={tSheet("open")}
                      className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-[6px] text-oms-ink-3 opacity-0 transition-all duration-fast hover:bg-oms-sunken hover:text-oms-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <BookOpen size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                  {canEdit && items.length > 1 && item.id !== "legacy" && (
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      title={t("removeItem")}
                      aria-label={t("removeItem")}
                      className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-[6px] text-oms-ink-3 opacity-0 transition-all duration-fast hover:bg-oms-bad-bg hover:text-oms-bad focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* Quantity × unit price, stated in full. `1 × 179` left you
                    guessing which number was the price and in what currency. */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <StepperField
                    value={item.quantity}
                    onCommit={(qty) => {
                      if (item.id === "legacy") {
                        onCommitLegacyQuantity(qty);
                      } else {
                        onPatchItem(item.id, { quantity: qty });
                      }
                    }}
                    min={1}
                    displayMode
                    readOnly={!canEdit}
                  />
                  <span className="text-[12.5px] text-oms-ink-3" aria-hidden="true">
                    ×
                  </span>
                  <InlineField
                    value={(Number(item.unit_price) || 0).toFixed(2)}
                    onCommit={(v) => {
                      const price = parseFloat(v) || 0;
                      if (item.id === "legacy") {
                        onCommitLegacyPrice(price);
                      } else {
                        onPatchItem(item.id, { unit_price: price });
                      }
                    }}
                    validate={(v) => (parseFloat(v) >= 0 ? null : "invalid")}
                    type="number"
                    displayMode
                    readOnly={!canEdit}
                    displayClassName={`text-[12.5px] tabular-nums text-oms-ink-2 ${editableText}`}
                  />
                  <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-oms-ink-3">
                    {displayCurrency}
                  </span>
                  {canEdit && (
                    <span
                      title={t("fieldUnitPrice")}
                      className="inline-flex flex-shrink-0 text-oms-ink-3 opacity-0 transition-opacity duration-fast group-hover:opacity-100"
                    >
                      <Pencil size={11} strokeWidth={2} aria-hidden="true" />
                    </span>
                  )}
                  {item.variant_label && (
                    <span className="truncate text-[12px] text-oms-ink-3" dir="auto">
                      · {item.variant_label}
                    </span>
                  )}
                </div>

                {stock !== null && (
                  <span
                    data-testid={`item-stock-${item.id}`}
                    className={`inline-flex items-center gap-1 text-[11.5px] font-semibold ${stockTone}`}
                  >
                    <i
                      aria-hidden="true"
                      className="block h-[5px] w-[5px] rounded-full bg-current"
                    />
                    {stockLabel}
                  </span>
                )}

                {(idx === 0 || item.id === "legacy") && variantOptions.length > 0 && canEdit && (
                  <select
                    value={item.variant_id ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => {
                      if (item.id === "legacy") onCommitLegacyVariant(e.target.value);
                    }}
                    className="mt-1 h-8 w-full rounded-[8px] border border-oms-border bg-oms-surface px-2.5 text-[12px] text-oms-ink-1 focus:border-oms-accent focus:outline-none"
                  >
                    <option value="">—</option>
                    {variantOptions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* The money spine. Fixed width and last in the row, so every
                  amount on this tab lands on one right edge. */}
              <Money
                amount={item.line_total}
                className="text-[14px] font-[650] text-oms-ink-1"
              />
            </div>
          </div>
        );
      })}

      {canEdit && renderAddProduct ? (
        <div className="pt-3">{renderAddProduct()}</div>
      ) : null}

      {/* Every value below sits in a 76px end-aligned column — the same one the
          line totals use — so the whole tab reads down a single spine. */}
      <div className="mt-[18px] border-t border-oms-border pt-3.5">
        <div className="flex items-baseline gap-3 py-[5px] text-[13px]">
          <span className="flex-1 text-oms-ink-2">{t("subtotal")}</span>
          <Money testId="items-subtotal" amount={subtotal} className="text-oms-ink-1" />
        </div>

        <div className="flex items-baseline gap-3 py-[5px] text-[13px]">
          <span className="flex-1 text-oms-ink-2">{t("fieldDeliveryFee")}</span>
          <span className="flex flex-shrink-0 items-baseline justify-end gap-1">
            <InlineField
              value={(Number(deliveryFee) || 0).toFixed(2)}
              onCommit={(v) => onCommitDeliveryFee(parseFloat(v) || 0)}
              type="number"
              displayMode
              readOnly={!canEdit}
              displayClassName={`block text-[13px] tabular-nums text-end text-oms-ink-1 ${
                canEdit
                  ? "underline decoration-dotted decoration-oms-border-strong underline-offset-[3px]"
                  : ""
              }`}
            />
            <span aria-hidden="true" className="w-[30px]" />
          </span>
        </div>

        {/* Read-only card-payment marker for legacy orders that already carry
            it — no longer editable here (see the Darb dispatch modal). */}
        {isLibyaOrder && cardPayment && (
          <div className="flex items-baseline gap-3 py-[5px] text-[13px]">
            <span className="flex-1 text-oms-ink-2">{t("cardPayment")}</span>
            <span className="w-[76px] flex-shrink-0 text-end text-[12px] font-semibold tabular-nums text-oms-ink-3">
              +10%
            </span>
          </div>
        )}

        <div className="mt-1.5 flex items-baseline gap-3 border-t border-oms-border pt-[11px]">
          <span className="flex-1 text-[10.5px] font-[650] uppercase tracking-[0.085em] text-oms-ink-3">
            {t("grandTotal")}
          </span>
          <Money
            testId="items-grand-total"
            amount={grandTotal}
            currency={displayCurrency}
            className="text-[16px] font-[650] tracking-[-0.02em] text-oms-ink-1"
          />
        </div>
      </div>

      {saveError && <div className="mt-1 text-[12px] text-oms-bad">{saveError}</div>}
    </div>
  );
}

/**
 * One amount on the receipt's money spine.
 *
 * The currency slot is reserved on every row and filled only on the grand
 * total. Without it, the one row that names its currency pushes its own digits
 * left and nothing below the line items lines up — which is exactly how the
 * column came to read as ragged.
 */
function Money({
  amount,
  currency,
  className = "",
  testId,
}: {
  amount: number;
  /** Rendered when present; the slot is reserved either way. */
  currency?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={`flex flex-shrink-0 items-baseline justify-end gap-1 ${className}`}
    >
      <span className="tabular-nums">{(Number(amount) || 0).toFixed(2)}</span>
      <span
        aria-hidden={currency ? undefined : "true"}
        className="w-[30px] text-start text-[10.5px] font-medium uppercase tracking-[0.05em] text-oms-ink-3"
      >
        {currency ?? ""}
      </span>
    </span>
  );
}
