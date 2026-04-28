"use client";

import React, { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Role } from "@/types";
import { canManageProducts } from "@/lib/product-permissions";
import { canViewProfitability } from "@/lib/profitability-permissions";
import { canToggleProductActive } from "@/lib/product-permissions";
import { isLowStock } from "@/lib/product-calculations";
import { useMarketScope } from "@/context/market-scope";
import {
  ProductsFilterBar,
  type ProductFilterMode,
  type ProductFilterStatus,
} from "@/components/products/ProductsFilterBar";
import { ProductCatalogRow } from "@/components/products/ProductCatalogRow";
import { BulkActionBar } from "@/components/products/BulkActionBar";
import { StockAdjustModal, type StockAdjustState } from "@/components/products/StockAdjustModal";
import { PortfolioStrip } from "@/components/products/PortfolioStrip";
import { PeriodSelector } from "@/components/dashboard/MetricsTable";
import type { Period } from "@/components/dashboard/MetricsTable";
import type { BulkProductMetrics } from "@/app/api/products/profitability-bulk/route";
import { sortProducts, type ProductSortKey } from "@/lib/product-sort";
import { formatCurrency } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ProductRow {
  id: string;
  market_id: string;
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
}

interface Market {
  id: string;
  name: string;
  code: string;
}

interface ProductsPageClientProps {
  role: Role;
  marketId: string;
  locale: string;
}

function todayPeriod(): Period {
  const d = new Date().toISOString().slice(0, 10);
  return { from_date: d, to_date: d };
}

const PAGE_SIZE = 50;

export function ProductsPageClient({ role, marketId, locale }: ProductsPageClientProps) {
  const t = useTranslations("products");

  const { marketId: scopeMarketId } = useMarketScope();
  // For super_admin, the selected market follows the global scope (TN/LY/All).
  // For managers, marketId comes from the server as their pinned market.
  const selectedMarketId =
    role === "super_admin" ? (scopeMarketId ?? "") : marketId;

  const canManage = canManageProducts(role, selectedMarketId, marketId);
  const canViewPerf = canViewProfitability(role);
  const canToggleActive = canToggleProductActive(role);

  const defaultMode: ProductFilterMode =
    role === "market_manager" ? "performance" : "catalogue";

  const [mode, setMode] = useState<ProductFilterMode>(defaultMode);
  const [status, setStatus] = useState<ProductFilterStatus>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<Period>(todayPeriod);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [stockModal, setStockModal] = useState<StockAdjustState | null>(null);
  const [sortKey, setSortKey] = useState<ProductSortKey>("default");

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    role === "super_admin" ? "/api/markets" : null,
    fetcher
  );
  const markets = marketsData?.data ?? [];

  const currentMarket = markets.find((m) => m.id === selectedMarketId);
  const currency = currentMarket?.code === "ly" ? "LYD" : "TND";
  const marketLabel =
    role === "super_admin"
      ? selectedMarketId
        ? currentMarket?.name ?? "—"
        : t("filters.allMarkets")
      : currentMarket?.name ?? "";

  const productKey = selectedMarketId
    ? `/api/products?market_id=${selectedMarketId}&page=${page}&limit=${PAGE_SIZE}`
    : null;

  const { data: productsData, mutate: mutateProducts } = useSWR<{
    data: ProductRow[];
    pagination?: { total: number; page: number; limit: number; totalPages: number };
  }>(productKey, fetcher);

  const products = productsData?.data ?? [];
  const totalPages = productsData?.pagination?.totalPages ?? 1;

  // Bulk profitability
  const profKey =
    canViewPerf && selectedMarketId
      ? `/api/products/profitability-bulk?market_id=${selectedMarketId}&from_date=${period.from_date}&to_date=${period.to_date}`
      : null;

  const { data: profData } = useSWR<{ data: BulkProductMetrics[]; currency: string }>(
    profKey,
    fetcher
  );

  const metricsMap = useMemo(() => {
    const m = new Map<string, BulkProductMetrics>();
    for (const item of profData?.data ?? []) {
      m.set(item.product_id, item);
    }
    return m;
  }, [profData]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (status === "active") {
      list = list.filter((p) => p.is_active);
    } else if (status === "lowStock") {
      list = list.filter((p) => isLowStock(p.current_stock, p.low_stock_threshold));
    } else if (status === "losingMoney") {
      list = list.filter((p) => {
        const m = metricsMap.get(p.id);
        return m !== undefined && m.margin_pct < 0;
      });
    }
    return sortProducts(list, metricsMap, sortKey);
  }, [products, search, status, metricsMap, sortKey]);

  const handleToggleActive = useCallback(
    async (productId: string) => {
      const product = products.find((p) => p.id === productId);
      if (!product) return;
      await fetch(`/api/products/${productId}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !product.is_active }),
      });
      mutateProducts();
    },
    [products, mutateProducts]
  );

  const handleThresholdSave = useCallback(
    async (productId: string, value: number) => {
      await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ low_stock_threshold: value }),
      });
      mutateProducts();
    },
    [mutateProducts]
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkActivate = useCallback(async () => {
    setBulkLoading(true);
    await Promise.allSettled(
      [...selectedIds].map((id) =>
        fetch(`/api/products/${id}/active`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: true }),
        })
      )
    );
    setBulkLoading(false);
    setSelectedIds(new Set());
    mutateProducts();
  }, [selectedIds, mutateProducts]);

  const handleBulkDeactivate = useCallback(async () => {
    setBulkLoading(true);
    await Promise.allSettled(
      [...selectedIds].map((id) =>
        fetch(`/api/products/${id}/active`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: false }),
        })
      )
    );
    setBulkLoading(false);
    setSelectedIds(new Set());
    mutateProducts();
  }, [selectedIds, mutateProducts]);

  const handleBulkClear = useCallback(() => setSelectedIds(new Set()), []);

  const openStockModal = useCallback((productId: string, productName: string) => {
    setStockModal({
      productId,
      productName,
      change: "",
      reason: "manual_adjustment",
      note: "",
      loading: false,
      error: null,
    });
  }, []);

  async function handleStockSubmit() {
    if (!stockModal) return;
    const changeNum = parseInt(stockModal.change, 10);
    if (!Number.isInteger(changeNum) || changeNum === 0) {
      setStockModal((s) => s && ({ ...s, error: "La quantité doit être un entier non nul." }));
      return;
    }
    if (!stockModal.note.trim()) {
      setStockModal((s) => s && ({ ...s, error: "La note est obligatoire." }));
      return;
    }
    setStockModal((s) => s && ({ ...s, loading: true, error: null }));
    const res = await fetch(`/api/products/${stockModal.productId}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change: changeNum, reason: stockModal.reason, note: stockModal.note.trim() }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setStockModal((s) => s && ({ ...s, loading: false, error: json.error ?? `Erreur ${res.status}` }));
      return;
    }
    setStockModal(null);
    mutateProducts();
  }

  if (role === "agent") return null;

  const allSelected =
    filteredProducts.length > 0 && filteredProducts.every((p) => selectedIds.has(p.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
    }
  };

  return (
    <>
      {stockModal && (
        <StockAdjustModal
          state={stockModal}
          onChange={(patch) => setStockModal((s) => s && ({ ...s, ...patch }))}
          onSubmit={handleStockSubmit}
          onClose={() => setStockModal((s) => (s && !s.loading ? null : s))}
        />
      )}

      <div className="flex flex-col gap-4">
        {/* Filter bar — bulk actions intentionally suppressed (handled by floating bar) */}
        <ProductsFilterBar
          marketLabel={marketLabel}
          mode={mode}
          onModeChange={setMode}
          status={status}
          onStatusChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
          search={search}
          onSearchChange={setSearch}
          selectedCount={0}
          onBulkActivate={handleBulkActivate}
          onBulkDeactivate={handleBulkDeactivate}
          onBulkClear={handleBulkClear}
          canManage={canManage}
          canViewPerformance={canViewPerf}
          locale={locale}
          sortKey={sortKey}
          onSortChange={setSortKey}
        />

        {mode === "performance" && canViewPerf && (
          <PeriodSelector period={period} onChange={setPeriod} />
        )}

        {mode === "performance" && canViewPerf && products.length > 0 && (
          <PortfolioStrip
            products={products.map((p) => ({
              id: p.id,
              name: p.name,
              current_stock: p.current_stock,
              low_stock_threshold: p.low_stock_threshold,
              is_active: p.is_active,
            }))}
            metricsMap={
              new Map(
                Array.from(metricsMap.entries()).map(([id, m]) => [
                  id,
                  { revenue: m.revenue, margin_pct: m.margin_pct },
                ]),
              )
            }
            formatRevenue={(n) => formatCurrency(n, currency.toUpperCase() === "LYD" ? "LY" : "TN")}
            labels={{
              topEarner: t("portfolio.topEarner"),
              worstMargin: t("portfolio.worstMargin"),
              lowStock: t("portfolio.lowStock"),
              active: t("portfolio.active"),
              ofTotal: (total) => t("portfolio.ofTotal", { total }),
              ofActive: (total) => t("portfolio.ofActive", { total }),
              noData: t("portfolio.noData"),
            }}
          />
        )}

        {/* Product list card */}
        <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-card">
          {filteredProducts.length === 0 ? (
            <div className="px-6 py-12 text-center text-[14px] text-ink-secondary">
              {t("emptyState")}
            </div>
          ) : (
            <>
              {/* Column header */}
              <div className="flex items-center border-b border-line bg-surface-page text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
                <span aria-hidden className="w-[3px] flex-shrink-0" />
                <div className="flex w-12 flex-shrink-0 items-center justify-center py-2">
                  <input
                    type="checkbox"
                    aria-label={allSelected ? t("bulk.clear") : "Sélectionner tout"}
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer accent-ink-primary"
                  />
                </div>
                <div className="flex-[2] py-2 pe-4">{t("table.product")}</div>
                <div className="w-[160px] flex-shrink-0 py-2 pe-4">{t("table.stock")}</div>
                <div className="flex-[3] py-2 pe-4">
                  {mode === "performance" ? t("metrics.margin") : t("table.unitCogs")}
                </div>
                <div className="w-[112px] flex-shrink-0 py-2 pe-4">{t("table.status")}</div>
                <div className="w-12 flex-shrink-0 py-2 pe-2 text-end">
                  {t("table.actions")}
                </div>
              </div>

              {filteredProducts.map((product) => (
                <ProductCatalogRow
                  key={product.id}
                  product={product}
                  metrics={metricsMap.get(product.id) ?? null}
                  mode={mode}
                  locale={locale}
                  currency={currency}
                  isSelected={selectedIds.has(product.id)}
                  onSelect={handleSelect}
                  onToggleActive={handleToggleActive}
                  onAdjustStock={openStockModal}
                  onThresholdSave={handleThresholdSave}
                  canManage={canManage}
                  canToggleActive={canToggleActive}
                />
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-end gap-3 border-t border-line-subtle bg-surface-card px-4 py-3 text-[13px] text-ink-secondary">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-md bg-ink-primary px-3 py-1 text-[13px] text-white transition-opacity duration-fast disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("pagination.previous")}
                  </button>
                  <span className="tabular-nums">
                    {t("pagination.pageOf", { page, total: totalPages })}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-md bg-ink-primary px-3 py-1 text-[13px] text-white transition-opacity duration-fast disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        loading={bulkLoading}
        onActivate={handleBulkActivate}
        onDeactivate={handleBulkDeactivate}
        onClear={handleBulkClear}
      />
    </>
  );
}
