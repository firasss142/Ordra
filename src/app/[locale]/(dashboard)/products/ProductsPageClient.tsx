"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Plus } from "lucide-react";
import type { Role } from "@/types";
import { canArchiveProduct, canManageProducts, canToggleProductActive } from "@/lib/product-permissions";
import { canViewProductProfitability } from "@/lib/finance-permissions";
import { useMarketScope } from "@/context/market-scope";
import { useProductsList } from "@/hooks/useProductsList";
import {
  parseProductListQuery,
  productListQueryToParams,
  type ProductListQuery,
} from "@/lib/products/list-filters";
import { periodLengthDays } from "@/lib/date";
import type { ProductListRow } from "@/types/product-list";
import { ProductsRowList } from "@/components/products/ProductsRowList";
import { BulkActionBar } from "@/components/products/BulkActionBar";
import { StockAdjustModal, type StockAdjustState } from "@/components/products/StockAdjustModal";
import {
  ArchiveProductModal,
  type ArchiveProductState,
} from "@/components/products/ArchiveProductModal";

interface Props {
  role: Role;
  marketId: string;
  locale: string;
}

/** Preference of the column picker, which died with the table. Purged on load. */
const LEGACY_COLUMN_STORAGE_KEY = "oms:products:columns";

/**
 * CSV columns.
 *
 * The picker is gone — rows have no columns to hide — so the export no longer
 * mirrors what is on screen; it carries a FIXED, complete set. Labels reuse the
 * existing `products.table.*` keys, and every key here is understood by
 * `csvCell` below (metric keys fall through to `row.metrics`).
 */
const CSV_COLUMNS: { key: string; labelKey: string }[] = [
  { key: "name", labelKey: "table.product" },
  { key: "sku", labelKey: "table.sku" },
  { key: "is_active", labelKey: "table.status" },
  { key: "stock", labelKey: "table.stock" },
  { key: "stock_value", labelKey: "table.stockValue" },
  { key: "unit_cogs", labelKey: "table.unitCogs" },
  { key: "packing_cost", labelKey: "table.packing" },
  { key: "default_price", labelKey: "table.price" },
  { key: "damaged", labelKey: "table.damaged" },
  { key: "total_leads", labelKey: "table.leads" },
  { key: "revenue", labelKey: "table.revenue" },
  { key: "net_profit", labelKey: "table.netProfit" },
  { key: "margin_pct", labelKey: "table.margin" },
  { key: "confirmation_rate", labelKey: "table.confRate" },
  { key: "delivery_rate", labelKey: "table.delivRate" },
  { key: "return_rate", labelKey: "table.returnRate" },
  { key: "ad_spend", labelKey: "table.adSpend" },
  { key: "cost_per_delivered", labelKey: "table.costPerDelivered" },
];

export function ProductsPageClient({ role, marketId, locale }: Props) {
  const t = useTranslations("products");
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();

  const { marketId: scopeMarketId } = useMarketScope();
  const selectedMarketId = role === "super_admin" ? (scopeMarketId ?? "") : marketId;

  const canManage = canManageProducts(role, selectedMarketId, marketId);
  const canToggleActive = canToggleProductActive(role);
  const canArchive = canArchiveProduct(role);
  const canViewPerf = canViewProductProfitability(role);

  // The URL is the single source of truth for everything the server sees.
  // Previously filter/sort lived in useState while page lived in the URL, so a
  // filtered view was neither shareable nor survivable across a reload.
  const query: ProductListQuery = useMemo(
    () => parseProductListQuery(urlParams),
    [urlParams],
  );

  const patchQuery = useCallback(
    (patch: Partial<ProductListQuery>) => {
      const next: ProductListQuery = { ...query, ...patch };
      // Any change to what is being LOOKED AT resets pagination in the SAME
      // navigation. The old page reset for search but not for sort, so sorting
      // from page 3 left you on page 3 of a reordered set.
      const changesResultSet =
        patch.filter !== undefined ||
        patch.sort !== undefined ||
        patch.dir !== undefined ||
        patch.q !== undefined ||
        patch.limit !== undefined;
      if (changesResultSet && patch.page === undefined) next.page = 1;

      const params = productListQueryToParams(next, { omitDefaults: true });
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [query, router, pathname],
  );

  /**
   * The drawer is gone: a row now navigates to /[locale]/products/[id].
   *
   * Links shared from the drawer era carry `?open=<id>`. Dropping the parameter
   * silently would turn every one of those links into "the list, unfiltered and
   * with nothing open", so they are forwarded to the sheet instead.
   */
  const openId = urlParams.get("open");
  useEffect(() => {
    if (!openId) return;
    router.replace(`/${locale}/products/${openId}`);
  }, [openId, locale, router]);

  // The column picker died with the table. Drop its stored preference rather
  // than leaving a dead key in every user's browser forever.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_COLUMN_STORAGE_KEY);
    } catch {
      // Private browsing — nothing to clean up.
    }
  }, []);

  // `totals` and `highlights` are deliberately not destructured: the KPI tiles
  // they fed are gone from this screen. They stay on the wire — the endpoint and
  // its tests still assert them — but nothing here consumes them.
  const {
    rows,
    pagination,
    facets,
    period,
    currency,
    isLoading,
    isValidating,
    mutate,
  } = useProductsList({
    marketId: selectedMarketId,
    query,
    enabled: canViewPerf && Boolean(selectedMarketId),
  });

  // ── selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Prune to visible rows whenever the result set changes, so a bulk action can
  // never hit a product the user can no longer see.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const all = rows.length > 0 && rows.every((r) => prev.has(r.id));
      return all ? new Set() : new Set(rows.map((r) => r.id));
    });
  }, [rows]);

  // ── mutations ──
  const [banner, setBanner] = useState<string | null>(null);
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(timer);
  }, [banner]);

  const [bulkLoading, setBulkLoading] = useState(false);

  const setActive = useCallback(
    async (ids: string[], value: boolean) => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/products/${id}/active`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: value }),
          }).then((r) => {
            if (!r.ok) throw new Error(String(r.status));
            return r;
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) setBanner(t("errors.toggleFailed", { count: failed }));
      // Revalidate rather than patch locally: a product deactivated while
      // filter=active must LEAVE the list, and only the server knows what
      // backfills its slot.
      await mutate();
    },
    [mutate, t],
  );

  const handleToggleActive = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      // Reads the real is_active off the row. This is the bug that made the old
      // toggle send `is_active: !undefined` = true, forever.
      void setActive([id], !row.is_active);
    },
    [rows, setActive],
  );

  // The inline low-stock-threshold input went with the table cell that held it:
  // a row shows "seuil 20" as a fact, not as a field. Editing it now lives where
  // every other product field lives — the edit page, one click away in the ⋯
  // menu. PATCH /api/products/[id] {low_stock_threshold} is untouched.

  const handleBulkActive = useCallback(
    async (value: boolean) => {
      setBulkLoading(true);
      await setActive([...selectedIds], value);
      setBulkLoading(false);
      setSelectedIds(new Set());
    },
    [selectedIds, setActive],
  );

  const handleExportCsv = useCallback(() => {
    const chosen = selectedIds.size > 0 ? rows.filter((r) => selectedIds.has(r.id)) : rows;
    const cols = CSV_COLUMNS;
    const header = ["id", ...cols.map((c) => t(c.labelKey))];
    const lines = [header, ...chosen.map((r) => [r.id, ...cols.map((c) => csvCell(r, c.key))])];
    const csv = lines
      .map((cells) =>
        cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");
    // BOM so Excel opens the Arabic product names as UTF-8 rather than mojibake.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products-${query.from_date}_${query.to_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, selectedIds, query.from_date, query.to_date, t]);

  // ── archivage ──────────────────────────────────────────────────────────
  // Le produit disparaît de la liste : on revalide plutôt que de retirer la
  // ligne localement, parce que seul le serveur sait quelle ligne remonte à sa
  // place dans la page courante.
  const [archiveModal, setArchiveModal] = useState<ArchiveProductState | null>(null);
  const openArchiveModal = useCallback((productId: string, productName: string) => {
    setArchiveModal({ productId, productName, loading: false, error: null });
  }, []);

  const confirmArchive = useCallback(async () => {
    setArchiveModal((s) => s && { ...s, loading: true, error: null });
    const target = archiveModal;
    if (!target) return;
    const res = await fetch(`/api/products/${target.productId}/archive`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      // 422 = le produit est encore actif. Le message générique du serveur ne
      // dirait pas quoi faire ; celui-ci si.
      const message =
        res.status === 422
          ? t("errors.archiveStillActive")
          : (json.error ?? t("errors.generic", { status: res.status }));
      setArchiveModal((s) => s && { ...s, loading: false, error: message });
      return;
    }
    setArchiveModal(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(target.productId);
      return next;
    });
    await mutate();
  }, [archiveModal, mutate, t]);

  // ── stock adjust modal ──
  const [stockModal, setStockModal] = useState<StockAdjustState | null>(null);
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

  async function submitStock() {
    if (!stockModal) return;
    const change = parseInt(stockModal.change, 10);
    if (!Number.isInteger(change) || change === 0) {
      setStockModal((s) => s && { ...s, error: t("stockModal.errorQuantity") });
      return;
    }
    if (!stockModal.note.trim()) {
      setStockModal((s) => s && { ...s, error: t("stockModal.errorNote") });
      return;
    }
    setStockModal((s) => s && { ...s, loading: true, error: null });
    const res = await fetch(`/api/products/${stockModal.productId}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        change,
        reason: stockModal.reason,
        note: stockModal.note.trim(),
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setStockModal(
        (s) =>
          s && {
            ...s,
            loading: false,
            error: json.error ?? t("errors.generic", { status: res.status }),
          },
      );
      return;
    }
    setStockModal(null);
    await mutate();
  }

  if (role === "agent") return null;

  const periodDays = period ? periodLengthDays(period.from_date, period.to_date) : 30;
  const periodLabel = t("period.lastNDays", { count: periodDays });
  const needsMarket = role === "super_admin" && !selectedMarketId;

  return (
    <>
      {archiveModal && (
        <ArchiveProductModal
          state={archiveModal}
          onConfirm={() => void confirmArchive()}
          onClose={() => setArchiveModal((s) => (s && !s.loading ? null : s))}
        />
      )}

      {stockModal && (
        <StockAdjustModal
          state={stockModal}
          onChange={(patch) => setStockModal((s) => s && { ...s, ...patch })}
          onSubmit={submitStock}
          onClose={() => setStockModal((s) => (s && !s.loading ? null : s))}
        />
      )}

      <div className="flex flex-col gap-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="m-0 text-[29px] font-semibold leading-tight tracking-[-0.028em] text-ink-primary">
              {t("title")}
            </h1>
            <p className="mt-[7px] text-[14.5px] font-normal text-ink-muted">
              {t("subtitle")}
              {isValidating && !isLoading && (
                <span className="ms-2 text-[13px] text-ink-muted">· {t("refreshing")}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={rows.length === 0}
              className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[11px] border border-line bg-surface-card px-[18px] text-[14px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={16} strokeWidth={2} className="text-ink-secondary" aria-hidden />
              {t("exportCsv")}
            </button>
            {canManage && (
              <Link
                href={`/${locale}/products/new`}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[11px] bg-prod-brand px-[18px] text-[14px] font-semibold text-white no-underline shadow-hover-row transition-colors duration-fast hover:bg-prod-brand-hover"
              >
                <Plus size={16} strokeWidth={2.6} aria-hidden />
                {t("addButton")}
              </Link>
            )}
          </div>
        </div>

        {banner && (
          <div
            role="alert"
            className="rounded-[10px] border border-status-critical/30 bg-status-criticalBg px-4 py-2.5 text-[13px] text-status-critical"
          >
            {banner}
          </div>
        )}

        {needsMarket ? (
          <div className="rounded-[15px] border border-line-subtle bg-surface-card px-6 py-16 text-center text-[14px] text-ink-secondary">
            {t("selectMarketPrompt")}
          </div>
        ) : !canViewPerf ? (
          <div className="rounded-[15px] border border-line-subtle bg-surface-card px-6 py-16 text-center text-[14px] text-ink-secondary">
            {t("noPermission")}
          </div>
        ) : (
          <ProductsRowList
            rows={rows}
            facets={facets}
            facet={query.filter}
            onFacetChange={(f) => patchQuery({ filter: f })}
            search={query.q}
            onSearchChange={(q) => patchQuery({ q })}
            sort={query.sort}
            dir={query.dir}
            onSortChange={(sort, dir) => patchQuery({ sort, dir })}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onToggleActive={handleToggleActive}
            onAdjustStock={openStockModal}
            onArchive={openArchiveModal}
            canManage={canManage}
            canToggleActive={canToggleActive}
            canArchive={canArchive}
            locale={locale}
            currency={currency}
            loading={isLoading}
            periodLabel={periodLabel}
            pagination={pagination}
            onPageChange={(page) => patchQuery({ page })}
            onPageSizeChange={(limit) => patchQuery({ limit })}
            bulkBar={
              <BulkActionBar
                selectedCount={selectedIds.size}
                loading={bulkLoading}
                canToggleActive={canToggleActive}
                onActivate={() => void handleBulkActive(true)}
                onDeactivate={() => void handleBulkActive(false)}
                onExport={handleExportCsv}
                onClear={() => setSelectedIds(new Set())}
              />
            }
          />
        )}
      </div>
    </>
  );
}

function csvCell(r: ProductListRow, key: string): string | number {
  switch (key) {
    case "name":
      return r.name;
    case "stock":
      return r.current_stock;
    case "sku":
      return r.sku ?? "";
    case "unit_cogs":
      return r.unit_cogs;
    case "packing_cost":
      return r.packing_cost;
    case "default_price":
      return r.default_price ?? "";
    case "stock_value":
      return r.current_stock * r.unit_cogs;
    case "damaged":
      return r.damaged_return_count;
    case "is_active":
      return r.is_active ? "1" : "0";
    default: {
      const m = r.metrics;
      if (!m) return "";
      const v = (m as unknown as Record<string, number>)[key];
      return v === undefined ? "" : v;
    }
  }
}
