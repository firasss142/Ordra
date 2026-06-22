"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Pencil, ShoppingBag, X } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { StepperField } from "@/components/ui/StepperField";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { SectionCard } from "./SectionCard";
import type { OrderItem } from "./types";

interface ProductLite {
  id: string;
  current_stock: number;
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
  /** Default-open in confirmed state, default-closed elsewhere. */
  defaultOpen?: boolean;
  onCommitLegacyProduct: (productId: string) => void;
  onCommitLegacyQuantity: (qty: number) => void;
  onCommitLegacyPrice: (price: number) => void;
  onCommitLegacyVariant: (variantId: string) => void;
  onPatchItem: (itemId: string, body: Record<string, unknown>) => void;
  onDeleteItem: (itemId: string) => void;
  onCommitDeliveryFee: (v: number) => void;
  /** Slot for the "+ add product" affordance — supplied by parent. */
  renderAddProduct?: () => ReactNode;
}

/**
 * Collapsible order receipt card. Collapsed shows a compact one-row summary
 * (product · qty × price · card-toggle · total); expanded shows the full
 * editable receipt. Always white, no tinted background.
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
  defaultOpen = false,
  onCommitLegacyProduct,
  onCommitLegacyQuantity,
  onCommitLegacyPrice,
  onCommitLegacyVariant,
  onPatchItem,
  onDeleteItem,
  onCommitDeliveryFee,
  renderAddProduct,
}: OrderItemsCardProps) {
  const t = useTranslations("orders.detail");
  const [open, setOpen] = useState(defaultOpen);

  const summaryItem = items[0];
  const extraItemCount = items.length - 1;

  // Collapsed-state summary inline trailing chip
  const trailing = !open ? (
    <span className="text-[12px] font-semibold tabular-nums text-ink-primary">
      {grandTotal}
      <span className="text-[10px] font-medium text-ink-secondary ms-1">{displayCurrency}</span>
    </span>
  ) : undefined;

  return (
    <SectionCard
      title={t("order")}
      icon={ShoppingBag}
      trailing={trailing}
      collapsible={{
        open,
        onToggle: () => setOpen((v) => !v),
        testId: "order-details-toggle",
      }}
    >
      {!open && summaryItem && (
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="truncate text-[14px] font-semibold text-ink-primary">
                {summaryItem.product_name}
              </span>
              {extraItemCount > 0 && (
                <span className="flex-shrink-0 text-[11px] font-medium text-ink-muted tabular-nums">
                  +{extraItemCount}
                </span>
              )}
            </div>
            <span className="text-[12px] text-ink-secondary tabular-nums">
              {summaryItem.quantity}
              <span className="text-ink-muted"> × </span>
              {summaryItem.unit_price} {displayCurrency}
            </span>
          </div>
          {/* Card-payment is no longer set here (online payment is handled in the
              Darb dispatch modal). Old orders that already carry it still show a
              read-only marker so their higher total is explained. */}
          {isLibyaOrder && cardPayment && (
            <span className="flex items-center gap-1.5 flex-shrink-0 text-[11px] text-ink-secondary whitespace-nowrap">
              {t("cardPayment")}
              <span className="text-[10px] font-semibold text-ink-muted tabular-nums">+10%</span>
            </span>
          )}
        </div>
      )}

      {open && (
        <div className="flex flex-col pt-1">
          {items.map((item, idx) => {
            const itemProduct = products.find((p) => p.id === item.product_id) ?? null;
            const stock = itemProduct?.current_stock ?? null;
            let stockTone: BadgeTone = "success";
            let stockLabel = t("inStock");
            if (stock !== null) {
              if (stock <= 0) {
                stockTone = "critical";
                stockLabel = t("outOfStock");
              } else if (stock <= 5) {
                stockTone = "warning";
                stockLabel = t("stockLeft", { count: stock });
              }
            }

            return (
              <div
                key={item.id}
                className="group -mx-2 px-2 py-2.5 rounded-card border-b border-line-subtle last:border-0 hover:bg-surface-hover transition-colors duration-fast"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
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
                      displayClassName="text-[14px] font-semibold text-ink-primary leading-snug"
                    />
                  </div>
                  {canEdit && items.length > 1 && item.id !== "legacy" && (
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      title={t("removeItem")}
                      aria-label={t("removeItem")}
                      className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded text-ink-muted opacity-0 group-hover:opacity-100 hover:text-status-critical hover:bg-status-criticalBg transition-all duration-fast"
                    >
                      <X size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                </div>

                {(item.variant_label || stock !== null) && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {item.variant_label && <Badge tone="neutral">{item.variant_label}</Badge>}
                    {stock !== null && (
                      <Badge tone={stockTone} dot>
                        {stockLabel}
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 mt-2">
                  <div className="flex items-center gap-2 min-w-0">
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
                    <span className="text-[12px] text-ink-muted">×</span>
                    <span className="inline-flex items-center gap-1 min-w-0">
                      <InlineField
                        value={String(item.unit_price)}
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
                        displayClassName="text-[12px] text-ink-secondary tabular-nums"
                      />
                      {canEdit && (
                        <span
                          title={t("fieldUnitPrice")}
                          className="flex-shrink-0 inline-flex text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                        >
                          <Pencil size={11} strokeWidth={2} aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    <span className="text-[12px] text-ink-muted">{displayCurrency}</span>
                  </div>
                  <span className="text-[14px] font-semibold text-ink-primary tabular-nums whitespace-nowrap">
                    {item.line_total}
                    <span className="text-[11px] font-normal text-ink-muted ms-1">{displayCurrency}</span>
                  </span>
                </div>

                {(idx === 0 || item.id === "legacy") && variantOptions.length > 0 && canEdit && (
                  <div className="mt-2">
                    <select
                      value={item.variant_id ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => {
                        if (item.id === "legacy") onCommitLegacyVariant(e.target.value);
                      }}
                      className="w-full h-8 px-2.5 text-[12px] rounded-card border border-line-subtle bg-surface-card text-ink-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    >
                      <option value="">—</option>
                      {variantOptions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}

          {canEdit && renderAddProduct ? renderAddProduct() : null}

          <div className="mt-2.5 pt-2.5 border-t border-line-subtle flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-secondary">{t("fieldDeliveryFee")}</span>
              <div className="w-[90px]">
                <InlineField
                  value={String(deliveryFee ?? 0)}
                  onCommit={(v) => onCommitDeliveryFee(parseFloat(v) || 0)}
                  type="number"
                  displayMode
                  readOnly={!canEdit}
                  displayClassName="text-[13px] text-ink-secondary tabular-nums text-end"
                />
              </div>
            </div>
            {/* Read-only card-payment marker for legacy orders that already have
                it (no longer editable here — see the Darb dispatch modal). */}
            {isLibyaOrder && cardPayment && (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                  {t("cardPayment")}
                  <span className="text-[11px] font-semibold text-ink-muted tabular-nums">+10%</span>
                </span>
              </div>
            )}
            <div className="-mx-2 mt-1 flex items-center justify-between rounded-card bg-surface-page border border-line-subtle px-3 py-2.5">
              <span className="text-[11px] font-semibold text-ink-primary uppercase tracking-[0.08em]">
                {t("grandTotal")}
              </span>
              <span className="text-[18px] font-bold text-ink-primary tabular-nums tracking-tight leading-none">
                {grandTotal}
                <span className="text-[12px] font-semibold text-ink-secondary ms-1.5">{displayCurrency}</span>
              </span>
            </div>
          </div>

          {saveError && <div className="text-[12px] text-status-critical mt-1">{saveError}</div>}
        </div>
      )}
    </SectionCard>
  );
}
