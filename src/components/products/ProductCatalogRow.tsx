"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { classifyProductHealth } from "@/lib/calculations/product-metrics-health";
import { isLowStock } from "@/lib/product-calculations";
import type { BulkProductMetrics } from "@/app/api/products/profitability-bulk/route";
import type { ProductFilterMode } from "./ProductsFilterBar";

interface ProductRow {
  id: string;
  name: string;
  unit_cogs: number;
  packing_cost: number;
  cpl: number;
  low_stock_threshold: number;
  current_stock: number;
  system_inventory?: number;
  real_inventory?: number;
  is_active: boolean;
  variant_count: number;
  market_id: string;
}

interface ProductCatalogRowProps {
  product: ProductRow;
  metrics: BulkProductMetrics | null;
  mode: ProductFilterMode;
  locale: string;
  currency: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onToggleActive: (id: string) => void;
  onAdjustStock: (id: string, name: string) => void;
  onThresholdSave: (id: string, value: number) => void;
  canManage: boolean;
  canToggleActive: boolean;
}

const HEALTH_COLORS = {
  green: "#008060",
  yellow: "#B45309",
  red: "#D72C0D",
  grey: "#9CA3AF",
};

const TEXT = "#1A1A1A";
const MUTED = "#6D7175";
const BORDER = "#E1E3E5";

function HealthDot({
  health,
  label,
}: {
  health: "green" | "yellow" | "red" | "grey";
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: HEALTH_COLORS[health],
        flexShrink: 0,
        color: HEALTH_COLORS[health],
      }}
    />
  );
}

function RowActionsMenu({
  productId,
  productName,
  locale,
  canManage,
  onAdjustStock,
}: {
  productId: string;
  productName: string;
  locale: string;
  canManage: boolean;
  onAdjustStock: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations("products");

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Actions"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 18,
          color: MUTED,
          padding: "4px 8px",
          borderRadius: 4,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            insetInlineEnd: 0,
            top: "calc(100% + 4px)",
            background: "#FFFFFF",
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 160,
            zIndex: 20,
            padding: 4,
          }}
        >
          <MenuOption
            label={t("edit")}
            href={`/${locale}/products/${productId}`}
            onClick={() => setOpen(false)}
          />
          {canManage && (
            <MenuOption
              label={t("adjustStock")}
              onClick={() => { onAdjustStock(productId, productName); setOpen(false); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuOption({
  label,
  href,
  onClick,
}: {
  label: string;
  href?: string;
  onClick: () => void;
}) {
  const style: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "start",
    padding: "8px 10px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: TEXT,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textDecoration: "none",
  };
  if (href) {
    return (
      <Link href={href} onClick={onClick} style={style}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} style={style}>
      {label}
    </button>
  );
}

export function ProductCatalogRow({
  product,
  metrics,
  mode,
  locale,
  currency,
  isSelected,
  onSelect,
  onToggleActive,
  onAdjustStock,
  onThresholdSave,
  canManage,
  canToggleActive,
}: ProductCatalogRowProps) {
  const t = useTranslations("products");
  const [thresholdEdit, setThresholdEdit] = useState(String(product.low_stock_threshold));
  const [menuOpen] = useState(false);
  void menuOpen;

  const health = metrics
    ? classifyProductHealth({
        totalLeads: metrics.total_leads,
        marginPct: metrics.margin_pct,
        deliveryRate: metrics.delivery_rate,
        returnRate: metrics.return_rate,
      })
    : "grey";

  const healthLabel = t(`health.${health}`);
  const lowStock = isLowStock(product.current_stock, product.low_stock_threshold);

  const fmtNum = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        borderBottom: `1px solid ${BORDER}`,
        background: "#FFFFFF",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#F7F7F7"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#FFFFFF"; }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        aria-label="Sélectionner"
        checked={isSelected}
        onChange={() => onSelect(product.id)}
        style={{ marginTop: 3, cursor: "pointer", flexShrink: 0 }}
      />

      {/* Health dot */}
      <div style={{ marginTop: 3, flexShrink: 0 }}>
        <HealthDot health={health} label={healthLabel} />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row 1: name + stock indicators */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link
            href={`/${locale}/products/${product.id}`}
            style={{ fontSize: 14, fontWeight: 600, color: TEXT, textDecoration: "none" }}
          >
            {product.name}
          </Link>

          {/* Stock */}
          <span style={{ fontSize: 13, color: lowStock ? "#D72C0D" : MUTED }}>
            {product.current_stock}
            {lowStock && (
              <span aria-label={t("lowStock")} style={{ marginInlineStart: 4, fontSize: 11, fontWeight: 600, color: "#D72C0D" }}>
                {t("lowStock")}
              </span>
            )}
            {" / "}
            {mode === "catalogue" && canManage ? (
              <input
                type="number"
                aria-label={t("row.editThreshold")}
                value={thresholdEdit}
                onChange={(e) => setThresholdEdit(e.target.value)}
                onBlur={() => {
                  const v = parseInt(thresholdEdit, 10);
                  if (!isNaN(v) && v >= 0) onThresholdSave(product.id, v);
                }}
                style={{
                  width: 48,
                  fontSize: 13,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 4,
                  padding: "1px 4px",
                  color: TEXT,
                }}
              />
            ) : (
              <span style={{ color: MUTED }}>{product.low_stock_threshold}</span>
            )}
          </span>

          {/* Variants badge */}
          {product.variant_count > 0 && (
            <Link
              href={`/${locale}/products/${product.id}`}
              style={{ fontSize: 12, color: MUTED, textDecoration: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "2px 6px" }}
            >
              {t("row.variants", { count: product.variant_count })}
            </Link>
          )}

          {/* Active toggle */}
          {canToggleActive && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                role="checkbox"
                aria-label="Statut actif"
                checked={product.is_active}
                onChange={() => onToggleActive(product.id)}
                style={{ cursor: "pointer" }}
              />
              <span style={{ fontSize: 12, color: product.is_active ? "#008060" : MUTED }}>
                {product.is_active ? t("activate") : t("deactivate")}
              </span>
            </label>
          )}
        </div>

        {/* Row 2: metrics or cost info */}
        <div style={{ marginTop: 4, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {mode === "performance" && metrics && metrics.total_leads > 0 ? (
            <>
              <span style={{ fontSize: 12, color: MUTED }}>
                {t("metrics.confirmationRate")} <strong style={{ color: TEXT }}>{metrics.confirmation_rate}%</strong>
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>
                {t("metrics.deliveryRate")} <strong style={{ color: TEXT }}>{metrics.delivery_rate}%</strong>
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>
                {t("metrics.returnRate")} <strong style={{ color: TEXT }}>{metrics.return_rate}%</strong>
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>
                {t("metrics.margin")}{" "}
                <strong style={{ color: metrics.margin_pct < 0 ? "#D72C0D" : metrics.margin_pct < 10 ? "#B45309" : "#008060" }}>
                  {metrics.margin_pct > 0 ? "+" : ""}{metrics.margin_pct}%
                </strong>
              </span>
            </>
          ) : mode === "performance" ? (
            <span style={{ fontSize: 12, color: MUTED }}>{t("metrics.noData")}</span>
          ) : (
            <>
              <span style={{ fontSize: 12, color: MUTED }}>
                COGS <strong style={{ color: TEXT }}>{fmtNum(product.unit_cogs)} {currency}</strong>
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>
                Emb. <strong style={{ color: TEXT }}>{fmtNum(product.packing_cost)} {currency}</strong>
              </span>
              <span style={{ fontSize: 12, color: MUTED }}>
                CPL <strong style={{ color: TEXT }}>{fmtNum(product.cpl)} {currency}</strong>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Row actions menu */}
      <RowActionsMenu
        productId={product.id}
        productName={product.name}
        locale={locale}
        canManage={canManage}
        onAdjustStock={onAdjustStock}
      />
    </div>
  );
}
