"use client";

import React, { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Role } from "@/types";
import { canManageProducts } from "@/lib/product-permissions";
import { canViewProfitability } from "@/lib/profitability-permissions";
import { canToggleProductActive } from "@/lib/product-permissions";
import { isLowStock } from "@/lib/product-calculations";
import { ProductsFilterBar, type ProductFilterMode, type ProductFilterStatus } from "@/components/products/ProductsFilterBar";
import { ProductCatalogRow } from "@/components/products/ProductCatalogRow";
import { StockAdjustModal, type StockAdjustState } from "@/components/products/StockAdjustModal";
import { PeriodSelector } from "@/components/dashboard/MetricsTable";
import type { Period } from "@/components/dashboard/MetricsTable";
import type { BulkProductMetrics } from "@/app/api/products/profitability-bulk/route";

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

  const canManage = canManageProducts(role, marketId, marketId);
  const canViewPerf = canViewProfitability(role);
  const canToggleActive = canToggleProductActive(role);

  const defaultMode: ProductFilterMode =
    role === "market_manager" ? "performance" : "catalogue";

  const [selectedMarketId, setSelectedMarketId] = useState(marketId);
  const [mode, setMode] = useState<ProductFilterMode>(defaultMode);
  const [status, setStatus] = useState<ProductFilterStatus>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<Period>(todayPeriod);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [stockModal, setStockModal] = useState<StockAdjustState | null>(null);

  // Markets list (super_admin only)
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    role === "super_admin" ? "/api/markets" : null,
    fetcher
  );
  const markets = marketsData?.data ?? [];

  // If role is not super_admin, build a locked market list from the initial marketId
  const effectiveMarkets: Market[] =
    role === "super_admin" ? markets : [{ id: marketId, name: "", code: "" }];

  // Currency from market
  const currentMarket = markets.find((m) => m.id === selectedMarketId);
  const currency = currentMarket?.code === "ly" ? "LYD" : "TND";

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

  // Client-side filter
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
    return list;
  }, [products, search, status, metricsMap]);

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

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Filter bar */}
        <ProductsFilterBar
          role={role}
          markets={effectiveMarkets.length > 0 && markets.length > 0 ? markets : effectiveMarkets}
          selectedMarketId={selectedMarketId}
          onMarketChange={(id) => { setSelectedMarketId(id); setPage(1); }}
          mode={mode}
          onModeChange={setMode}
          status={status}
          onStatusChange={(s) => { setStatus(s); setPage(1); }}
          search={search}
          onSearchChange={setSearch}
          selectedCount={selectedIds.size}
          onBulkActivate={handleBulkActivate}
          onBulkDeactivate={handleBulkDeactivate}
          onBulkClear={handleBulkClear}
          canManage={canManage}
          canViewPerformance={canViewPerf}
          locale={locale}
        />

        {/* Period selector — only in performance mode */}
        {mode === "performance" && canViewPerf && (
          <PeriodSelector period={period} onChange={setPeriod} />
        )}

        {/* Product list */}
        <div
          style={{
            backgroundColor: "white",
            border: "1px solid #E1E3E5",
            borderRadius: "0.5rem",
            overflow: "hidden",
          }}
        >
          {filteredProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: "#6D7175", fontSize: 14 }}>
              {t("emptyState")}
            </div>
          ) : (
            <>
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 12,
                    padding: "12px 16px",
                    fontSize: 13,
                    color: "#6D7175",
                    borderTop: "1px solid #E1E3E5",
                  }}
                >
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    style={{
                      padding: "4px 12px",
                      fontSize: 13,
                      backgroundColor: page <= 1 ? "#9CA3AF" : "#1A1A1A",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "0.375rem",
                      cursor: page <= 1 ? "not-allowed" : "pointer",
                    }}
                  >
                    {t("pagination.previous")}
                  </button>
                  <span>{t("pagination.pageOf", { page, total: totalPages })}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    style={{
                      padding: "4px 12px",
                      fontSize: 13,
                      backgroundColor: page >= totalPages ? "#9CA3AF" : "#1A1A1A",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "0.375rem",
                      cursor: page >= totalPages ? "not-allowed" : "pointer",
                    }}
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
