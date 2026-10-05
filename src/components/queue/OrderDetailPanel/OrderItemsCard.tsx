"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { StepperField } from "@/components/ui/StepperField";
import { Ic, Thumb } from "@/components/orders/commandes/ui";
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
  onCommitLegacyProduct: (productId: string) => void;
  onCommitLegacyQuantity: (qty: number) => void;
  onCommitLegacyPrice: (price: number) => void;
  onCommitLegacyVariant: (variantId: string) => void;
  onPatchItem: (itemId: string, body: Record<string, unknown>) => void;
  onDeleteItem: (itemId: string) => void;
  onCommitDeliveryFee: (v: number) => void;
  /** Opens the agent product sheet for a given line's product. */
  onOpenProductSheet?: (productId: string | null) => void;
  /** The pane's action row — « Ajouter un produit », « Fusionner » — supplied by the parent. */
  renderAddProduct?: () => ReactNode;
}

const STOCK_TONE: Record<string, string> = { critical: "bad", warning: "warn", success: "ok" };

/**
 * The Articles pane (prototypes/commandes-v4.html `paneHTML` « art »): one
 * `.line` per product — thumb, name, variant, quantity × price, amount — then
 * the pane's actions, then the totals. Every value stays editable in place.
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
  const money = (n: number) => (Number(n) || 0).toFixed(2);

  return (
    <>
      {items.map((item, idx) => {
        const product = products.find((p) => p.id === item.product_id) ?? null;
        const stock = product?.current_stock ?? null;
        const badge = stock !== null ? stockBadge(stock) : null;
        const isLegacy = item.id === "legacy";

        return (
          <div key={item.id} className="line">
            <Thumb src={product?.image_url ?? null} seed={item.product_id ?? item.product_name} />
            <div>
              <div className="odp-name">
                <b dir="auto">
                  <Combobox
                    value={item.product_name}
                    options={[]}
                    loadOptions={loadProducts}
                    onCommit={(productId) =>
                      isLegacy ? onCommitLegacyProduct(productId) : onPatchItem(item.id, { product_id: productId })
                    }
                    placeholder={t("pickProduct")}
                    displayMode
                    readOnly={!canEdit}
                    displayClassName="!text-[14px] !text-[#0F1728] font-bold"
                  />
                </b>
                {onOpenProductSheet && (
                  <button type="button" className="mini" onClick={() => onOpenProductSheet(item.product_id)} title={tSheet("open")} aria-label={tSheet("open")}>
                    <Ic n="book" />
                  </button>
                )}
                {canEdit && items.length > 1 && !isLegacy && (
                  <button type="button" className="mini" onClick={() => onDeleteItem(item.id)} title={t("removeItem")} aria-label={t("removeItem")}>
                    <Ic n="x" />
                  </button>
                )}
              </div>
              {item.variant_label && <small dir="auto">{item.variant_label}</small>}
              <span className="odp-qty">
                <StepperField
                  value={item.quantity}
                  onCommit={(qty) => (isLegacy ? onCommitLegacyQuantity(qty) : onPatchItem(item.id, { quantity: qty }))}
                  min={1}
                  displayMode
                  readOnly={!canEdit}
                />
                <span aria-hidden="true">×</span>
                <InlineField
                  value={money(item.unit_price)}
                  onCommit={(v) => {
                    const price = parseFloat(v) || 0;
                    if (isLegacy) onCommitLegacyPrice(price);
                    else onPatchItem(item.id, { unit_price: price });
                  }}
                  validate={(v) => (parseFloat(v) >= 0 ? null : "invalid")}
                  type="number"
                  displayMode
                  readOnly={!canEdit}
                  displayClassName="!text-[12.5px] !text-[#667085] tabular-nums"
                />
                <span>{displayCurrency}</span>
              </span>
              {badge && (
                <span data-testid={`item-stock-${item.id}`} className={`odp-stock ${STOCK_TONE[badge.tone] ?? "ok"}`}>
                  <i aria-hidden="true" />
                  {t(badge.key, badge.count !== undefined ? { count: badge.count } : undefined)}
                </span>
              )}
              {(idx === 0 || isLegacy) && variantOptions.length > 0 && canEdit && (
                <select
                  value={item.variant_id ?? ""}
                  onChange={(e) => {
                    if (isLegacy) onCommitLegacyVariant(e.target.value);
                  }}
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
            <b className="amt">
              {money(item.line_total)}
              <small> {displayCurrency}</small>
            </b>
          </div>
        );
      })}

      {canEdit && renderAddProduct ? <div className="pane-acts">{renderAddProduct()}</div> : null}

      <div className="tot">
        <div>
          <span>{t("subtotal")}</span>
          <span data-testid="items-subtotal">
            {money(subtotal)} {displayCurrency}
          </span>
        </div>
        <div>
          <span>{t("fieldDeliveryFee")}</span>
          <span className="odp-fee">
            <InlineField
              value={money(deliveryFee)}
              onCommit={(v) => onCommitDeliveryFee(parseFloat(v) || 0)}
              type="number"
              displayMode
              readOnly={!canEdit}
              displayClassName="!text-[13.5px] !text-[#475467] tabular-nums"
            />
            {displayCurrency}
          </span>
        </div>
        {/* Read-only marker for legacy orders that already carry it. */}
        {isLibyaOrder && cardPayment && (
          <div>
            <span>{t("cardPayment")}</span>
            <span>+10%</span>
          </div>
        )}
        <div className="big">
          <span>{t("grandTotal")}</span>
          <span data-testid="items-grand-total">
            {money(grandTotal)} {displayCurrency}
          </span>
        </div>
      </div>

    </>
  );
}
