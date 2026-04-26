"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { getProductHealth, isLowStock, type ProductHealth } from "@/lib/product-calculations";
import type { BulkProductMetrics } from "@/app/api/products/profitability-bulk/route";
import type { ProductFilterMode } from "./ProductsFilterBar";
import { HealthDot } from "./HealthDot";
import { MarginBar } from "./MarginBar";

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

const HEALTH_TO_LABEL_KEY: Record<ProductHealth, "green" | "yellow" | "red"> = {
  green: "green",
  amber: "yellow",
  red: "red",
};

const HEALTH_STRIP_BG: Record<ProductHealth, string> = {
  green: "#008060",
  amber: "#B98900",
  red: "#D72C0D",
};

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
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Actions"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors duration-fast hover:bg-surface-selected hover:text-ink-primary"
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute end-0 top-[calc(100%+4px)] z-20 min-w-[180px] rounded-card border border-line bg-surface-card p-1 shadow-floating"
        >
          <MenuOption
            label={t("edit")}
            href={`/${locale}/products/${productId}`}
            onClick={() => setOpen(false)}
          />
          {canManage && (
            <MenuOption
              label={t("adjustStock")}
              onClick={() => {
                onAdjustStock(productId, productName);
                setOpen(false);
              }}
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
  const className =
    "block w-full rounded-md px-3 py-2 text-start text-[13px] font-medium text-ink-primary no-underline hover:bg-surface-hover";
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
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

  const health = getProductHealth({
    isActive: product.is_active,
    currentStock: product.current_stock,
    lowStockThreshold: product.low_stock_threshold,
    marginPct: metrics && metrics.total_leads > 0 ? metrics.margin_pct : null,
  });

  const healthLabel = t(`health.${HEALTH_TO_LABEL_KEY[health]}`);
  const lowStock = isLowStock(product.current_stock, product.low_stock_threshold);

  const fmtNum = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const hasMetrics = mode === "performance" && metrics && metrics.total_leads > 0;

  return (
    <div
      className={`group relative flex min-h-[68px] items-stretch border-b border-line-subtle transition-colors duration-fast ${
        isSelected ? "bg-surface-selected" : "bg-surface-card hover:bg-surface-hover"
      }`}
    >
      {/* Health accent strip */}
      <span
        aria-hidden
        className="w-[3px] flex-shrink-0"
        style={{ backgroundColor: HEALTH_STRIP_BG[health] }}
      />

      {/* Checkbox */}
      <div className="flex w-12 flex-shrink-0 items-center justify-center">
        <input
          type="checkbox"
          aria-label="Sélectionner"
          checked={isSelected}
          onChange={() => onSelect(product.id)}
          className="h-4 w-4 cursor-pointer accent-ink-primary"
        />
      </div>

      {/* Product name + chips */}
      <div className="flex min-w-0 flex-[2] flex-col justify-center gap-1 py-3 pe-4">
        <div className="flex items-center gap-2">
          <HealthDot health={health} label={healthLabel} />
          <Link
            href={`/${locale}/products/${product.id}`}
            className="truncate text-[14px] font-semibold text-ink-primary no-underline hover:underline"
          >
            {product.name}
          </Link>
        </div>
        {(product.variant_count > 0 || lowStock) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {product.variant_count > 0 && (
              <Link
                href={`/${locale}/products/${product.id}`}
                className="inline-flex items-center rounded-md border border-line-subtle bg-surface-page px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary no-underline transition-colors duration-fast hover:border-line-strong"
              >
                {t("row.variants", { count: product.variant_count })}
              </Link>
            )}
            {lowStock && (
              <span
                aria-label={t("lowStock")}
                className="inline-flex items-center rounded-pill bg-status-criticalBg px-2 py-0.5 text-[11px] font-medium text-status-critical"
              >
                {t("lowStock")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stock cell */}
      <div className="flex w-[160px] flex-shrink-0 flex-col justify-center gap-0.5 py-3 pe-4">
        <div className="flex items-baseline gap-1 tabular-nums">
          <span className={`text-[15px] font-semibold ${lowStock ? "text-status-critical" : "text-ink-primary"}`}>
            {product.current_stock}
          </span>
          <span className="text-[12px] text-ink-secondary">/</span>
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
              className="w-12 rounded-md border border-line bg-surface-card px-1.5 py-0.5 text-[12px] tabular-nums text-ink-primary"
            />
          ) : (
            <span className="text-[12px] tabular-nums text-ink-secondary">{product.low_stock_threshold}</span>
          )}
        </div>
        <span className="text-[11px] uppercase tracking-[0.04em] text-ink-secondary">{t("table.stock")}</span>
      </div>

      {/* Metrics or cost cell */}
      <div className="flex flex-[3] flex-col justify-center gap-1 py-3 pe-4">
        {hasMetrics && metrics ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-[12px] text-ink-secondary">
                {t("metrics.confirmationRate")}{" "}
                <strong className="tabular-nums text-ink-primary">{metrics.confirmation_rate}%</strong>
              </span>
              <span className="text-[12px] text-ink-secondary">
                {t("metrics.deliveryRate")}{" "}
                <strong className="tabular-nums text-ink-primary">{metrics.delivery_rate}%</strong>
              </span>
              <span className="text-[12px] text-ink-secondary">
                {t("metrics.returnRate")}{" "}
                <strong className="tabular-nums text-ink-primary">{metrics.return_rate}%</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
              <span>{t("metrics.margin")}</span>
              <MarginBar marginPct={metrics.margin_pct} />
            </div>
          </>
        ) : mode === "performance" ? (
          <span className="text-[12px] italic text-ink-secondary">{t("metrics.noData")}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-[12px] text-ink-secondary">
              COGS{" "}
              <strong className="tabular-nums text-ink-primary">
                {fmtNum(product.unit_cogs)} {currency}
              </strong>
            </span>
            <span className="text-[12px] text-ink-secondary">
              Emb.{" "}
              <strong className="tabular-nums text-ink-primary">
                {fmtNum(product.packing_cost)} {currency}
              </strong>
            </span>
            <span className="text-[12px] text-ink-secondary">
              CPL{" "}
              <strong className="tabular-nums text-ink-primary">
                {fmtNum(product.cpl)} {currency}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Status toggle */}
      <div className="flex w-[112px] flex-shrink-0 items-center justify-start py-3 pe-4">
        {canToggleActive ? (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <span
              className={`relative inline-block h-[18px] w-[30px] rounded-pill transition-colors duration-fast ${
                product.is_active ? "bg-status-success" : "bg-line-strong"
              }`}
            >
              <input
                type="checkbox"
                role="checkbox"
                aria-label="Statut actif"
                checked={product.is_active}
                onChange={() => onToggleActive(product.id)}
                className="sr-only"
              />
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all duration-fast ${
                  product.is_active ? "start-[14px]" : "start-[2px]"
                }`}
              />
            </span>
            <span
              className={`text-[12px] font-medium ${
                product.is_active ? "text-status-success" : "text-ink-secondary"
              }`}
            >
              {product.is_active ? t("activate") : t("deactivate")}
            </span>
          </label>
        ) : (
          <span
            className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-medium ${
              product.is_active
                ? "bg-status-successBg text-status-success"
                : "bg-status-neutralBg text-ink-secondary"
            }`}
          >
            {product.is_active ? t("activate") : t("deactivate")}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex w-12 flex-shrink-0 items-center justify-center pe-2">
        <RowActionsMenu
          productId={product.id}
          productName={product.name}
          locale={locale}
          canManage={canManage}
          onAdjustStock={onAdjustStock}
        />
      </div>
    </div>
  );
}
