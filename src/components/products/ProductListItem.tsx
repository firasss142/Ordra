"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { isLowStock } from "@/lib/product-calculations";

interface ProductListItemProduct {
  id: string;
  name: string;
  unit_cogs: number;
  packing_cost: number;
  low_stock_threshold: number;
  current_stock: number;
  system_inventory?: number;
  real_inventory?: number;
  is_active: boolean;
  variant_count: number;
}

interface ProductListItemProps {
  product: ProductListItemProduct;
  locale: string;
  currency: string;
  onToggleActive: (id: string) => void;
  onAdjustStock?: (id: string, name: string) => void;
  canManage?: boolean;
  canToggleActive?: boolean;
}

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
};

const formatterCache = new Map<string, Intl.NumberFormat>();
function getFormatter(locale: string): Intl.NumberFormat {
  let fmt = formatterCache.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatterCache.set(locale, fmt);
  }
  return fmt;
}

function formatCurrency(value: number, locale: string, currency: string): string {
  return `${getFormatter(locale).format(value)} ${currency}`;
}

function ProductListItemInner({
  product,
  locale,
  currency,
  onToggleActive,
  onAdjustStock,
  canManage = true,
  canToggleActive = true,
}: ProductListItemProps) {
  const t = useTranslations("products");

  const lowStock =
    product.low_stock_threshold > 0 &&
    isLowStock(product.current_stock, product.low_stock_threshold);

  return (
    <tr
      style={{ background: "white" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = "#F7F7F7";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = "white";
      }}
    >
      <td style={tdStyle}>{product.name}</td>
      <td style={tdStyle}>{product.variant_count}</td>
      <td style={tdStyle}>
        {product.current_stock}
        {lowStock && (
          <span
            aria-label={t("lowStock")}
            style={{
              color: "#D72C0D",
              fontSize: 12,
              fontWeight: 500,
              marginInlineStart: 8,
            }}
          >
            {t("lowStock")}
          </span>
        )}
      </td>
      <td style={{ ...tdStyle, color: "#6D7175" }}>
        {product.system_inventory ?? "—"}
      </td>
      <td style={{ ...tdStyle, color: "#6D7175" }}>
        {product.real_inventory ?? "—"}
      </td>
      <td style={tdStyle}>{product.low_stock_threshold}</td>
      <td style={tdStyle}>{formatCurrency(product.unit_cogs, locale, currency)}</td>
      <td style={tdStyle}>{formatCurrency(product.packing_cost, locale, currency)}</td>
      <td style={tdStyle}>
        <span
          style={{
            color: product.is_active ? "#008060" : "#6D7175",
            fontSize: 16,
          }}
        >
          ●
        </span>
      </td>
      <td style={tdStyle}>
        {canManage && (
          <Link
            href={`/${locale}/products/${product.id}`}
            style={{
              color: "#2C6ECB",
              fontSize: 14,
              textDecoration: "none",
              marginInlineEnd: 12,
            }}
          >
            {t("edit")}
          </Link>
        )}
        {canToggleActive && (
          <button
            onClick={() => onToggleActive(product.id)}
            style={{
              background: "none",
              border: "none",
              color: "#2C6ECB",
              fontSize: 14,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {product.is_active ? t("deactivate") : t("activate")}
          </button>
        )}
        {onAdjustStock && (
          <button
            onClick={() => onAdjustStock(product.id, product.name)}
            style={{
              background: "none",
              border: "none",
              color: "#2C6ECB",
              fontSize: 14,
              cursor: "pointer",
              padding: 0,
              marginInlineStart: canToggleActive || canManage ? 12 : 0,
            }}
          >
            {t("adjustStock")}
          </button>
        )}
      </td>
    </tr>
  );
}

export const ProductListItem = React.memo(ProductListItemInner);

