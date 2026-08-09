"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ChevronsUpDown, PackageSearch } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/shared/Pagination";
import type {
  ProductListPagination,
  ProductListRow,
  ProductSortKey,
  SortDirection,
} from "@/types/product-list";
import { PRODUCT_PAGE_SIZES } from "@/types/product-list";
import { ProductsTableRow } from "./ProductsTableRow";

export interface ProductColumn {
  key: string;
  labelKey: string;
  width?: number;
  sort?: ProductSortKey;
  align?: "start" | "end" | "center";
  /** Locked columns cannot be hidden by the column picker. */
  locked?: boolean;
}

/**
 * Column order and default visibility.
 *
 * Default set = identity + an always-on stock chip + the profit block + the
 * funnel block. Cost columns are available but hidden: they were the ones
 * rendering "NaN LYD", and they matter when editing rather than when scanning.
 */
export const PRODUCT_COLUMNS: ProductColumn[] = [
  { key: "name", labelKey: "table.product", sort: "name", locked: true },
  { key: "stock", labelKey: "table.stock", width: 104, sort: "current_stock", align: "end", locked: true },
  { key: "sku", labelKey: "table.sku", width: 120 },
  { key: "unit_cogs", labelKey: "table.unitCogs", width: 118, sort: "unit_cogs", align: "end" },
  { key: "packing_cost", labelKey: "table.packing", width: 112, align: "end" },
  { key: "default_price", labelKey: "table.price", width: 112, align: "end" },
  { key: "stock_value", labelKey: "table.stockValue", width: 126, align: "end" },
  { key: "revenue", labelKey: "table.revenue", width: 128, sort: "revenue", align: "end" },
  { key: "net_profit", labelKey: "table.netProfit", width: 130, sort: "net_profit", align: "end" },
  { key: "margin_pct", labelKey: "table.margin", width: 156, sort: "margin_pct" },
  { key: "confirmation_rate", labelKey: "table.confRate", width: 98, sort: "confirmation_rate", align: "center" },
  { key: "delivery_rate", labelKey: "table.delivRate", width: 92, sort: "delivery_rate", align: "center" },
  { key: "return_rate", labelKey: "table.returnRate", width: 96, sort: "return_rate", align: "center" },
  { key: "total_leads", labelKey: "table.leads", width: 104, sort: "total_leads", align: "center" },
  { key: "ad_spend", labelKey: "table.adSpend", width: 116, align: "end" },
  { key: "cost_per_delivered", labelKey: "table.costPerDelivered", width: 124, align: "end" },
  { key: "damaged", labelKey: "table.damaged", width: 108, align: "center" },
  { key: "is_active", labelKey: "table.status", width: 114, sort: "is_active", locked: true },
];

export const DEFAULT_VISIBLE_COLUMNS = [
  "name",
  "stock",
  "revenue",
  "net_profit",
  "margin_pct",
  "confirmation_rate",
  "delivery_rate",
  "return_rate",
  "is_active",
];

interface Props {
  rows: ProductListRow[];
  visibleColumns: string[];
  sort: ProductSortKey;
  dir: SortDirection;
  onSort: (key: ProductSortKey) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onOpen: (id: string) => void;
  openId: string | null;
  onThresholdSave: (id: string, value: number) => void;
  onToggleActive: (id: string) => void;
  onAdjustStock: (id: string, name: string) => void;
  canManage: boolean;
  canToggleActive: boolean;
  locale: string;
  currency: string;
  loading: boolean;
  searchTerm: string;
  pagination: ProductListPagination | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange: (n: number) => void;
  bulkBar?: React.ReactNode;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }) {
  if (!active) {
    return (
      <ChevronsUpDown
        size={11}
        strokeWidth={2.6}
        aria-hidden
        className="flex-none opacity-0 transition-opacity duration-fast group-hover/sort:opacity-50"
      />
    );
  }
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return <Icon size={11} strokeWidth={3} aria-hidden className="flex-none text-prod-pos" />;
}

export function ProductsTable(props: Props) {
  const t = useTranslations("products");
  const {
    rows,
    visibleColumns,
    sort,
    dir,
    onSort,
    selectedIds,
    onToggleSelectAll,
    loading,
    searchTerm,
    pagination,
    onPageChange,
    onPageSizeChange,
    bulkBar,
  } = props;

  const cols = PRODUCT_COLUMNS.filter((c) => visibleColumns.includes(c.key));
  const minWidth = 220 + cols.reduce((sum, c) => sum + (c.width ?? 260), 0) + 60;

  if (loading && rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-[15px] border border-line-subtle bg-surface-card">
        <div role="status" aria-label={t("table.loading")} className="flex flex-col gap-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-[15px] border border-line-subtle bg-surface-card">
        <div className="flex flex-col items-center gap-3 px-6 py-[84px] text-center">
          <span className="grid h-[52px] w-[52px] place-items-center rounded-[15px] border border-line-subtle bg-surface-sunken text-ink-muted">
            <PackageSearch size={23} strokeWidth={1.8} aria-hidden />
          </span>
          <h4 className="m-0 text-[15px] font-semibold text-ink-primary">
            {searchTerm ? t("emptySearchTitle") : t("emptyState")}
          </h4>
          <p className="m-0 max-w-[40ch] text-[13.5px] leading-relaxed text-ink-secondary">
            {searchTerm ? t("noSearchMatch", { q: searchTerm }) : t("emptyStateHint")}
          </p>
        </div>
      </div>
    );
  }

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  return (
    <div className="overflow-hidden rounded-[15px] border border-line-subtle bg-surface-card">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse" style={{ minWidth }}>
          <colgroup>
            <col style={{ width: 52 }} />
            {cols.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
            <col style={{ width: 60 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 z-[2] h-[50px] border-b border-line-subtle bg-surface-card p-0">
                <span className="flex h-[50px] items-center justify-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleSelectAll}
                    aria-label={t("table.selectAll")}
                    className="h-[17px] w-[17px] cursor-pointer accent-prod-brand"
                  />
                </span>
              </th>
              {cols.map((c) => {
                const isSorted = c.sort !== undefined && sort === c.sort;
                const justify =
                  c.align === "end"
                    ? "justify-end"
                    : c.align === "center"
                      ? "justify-center"
                      : "justify-start";
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      isSorted ? (dir === "asc" ? "ascending" : "descending") : undefined
                    }
                    className="sticky top-0 z-[2] h-[50px] whitespace-nowrap border-b border-line-subtle bg-surface-card p-0 text-start text-[13.5px] font-medium text-ink-secondary"
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.sort!)}
                        className={`group/sort flex h-[50px] w-full items-center gap-1.5 px-[18px] text-[13.5px] transition-colors duration-fast hover:text-ink-primary ${justify} ${
                          isSorted ? "font-semibold text-ink-primary" : "font-medium"
                        }`}
                      >
                        {t(c.labelKey)}
                        <SortIcon active={isSorted} dir={dir} />
                      </button>
                    ) : (
                      <span className={`flex h-[50px] items-center px-[18px] ${justify}`}>
                        {t(c.labelKey)}
                      </span>
                    )}
                  </th>
                );
              })}
              <th className="sticky top-0 z-[2] h-[50px] border-b border-line-subtle bg-surface-card p-0">
                <span className="sr-only">{t("table.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ProductsTableRow
                key={row.id}
                row={row}
                columns={cols}
                isSelected={props.selectedIds.has(row.id)}
                isOpen={props.openId === row.id}
                onToggleSelect={props.onToggleSelect}
                onOpen={props.onOpen}
                onThresholdSave={props.onThresholdSave}
                onToggleActive={props.onToggleActive}
                onAdjustStock={props.onAdjustStock}
                canManage={props.canManage}
                canToggleActive={props.canToggleActive}
                locale={props.locale}
                currency={props.currency}
              />
            ))}
          </tbody>
        </table>
      </div>

      {bulkBar}

      {pagination && (
        <Pagination
          currentPage={pagination.page}
          pageSize={pagination.limit}
          pageSizeOptions={[...PRODUCT_PAGE_SIZES]}
          totalItems={pagination.total}
          hasPrev={pagination.page > 1}
          hasNext={pagination.page < pagination.totalPages}
          // Server-computed. The old page derived these from the post-client-
          // filter length against a server total, so they could contradict.
          rangeFrom={pagination.total === 0 ? undefined : pagination.rangeFrom}
          rangeTo={pagination.total === 0 ? undefined : pagination.rangeTo}
          onPrev={() => onPageChange(Math.max(1, pagination.page - 1))}
          onNext={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}
