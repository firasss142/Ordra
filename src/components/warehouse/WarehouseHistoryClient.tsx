"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { useWarehouseList } from "@/hooks/useWarehouseList";
import { useWarehouseHistoryFiltersUrl } from "@/hooks/useWarehouseHistoryFiltersUrl";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatDateTime } from "@/lib/format";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import { WarehousePagination } from "./WarehousePagination";
import {
  WAREHOUSE_HISTORY_KINDS,
  hasActiveWarehouseHistoryFilters,
  clearWarehouseHistoryField,
  type WarehouseHistoryKind,
} from "@/lib/warehouse/list-filters";
import type { WarehouseHistoryPage, WarehouseHistoryRow } from "@/hooks/useWarehouseList";

const D = {
  pageBg: "#F6F6F7",
  cardBg: "#FFFFFF",
  sectionBg: "#F6F6F7",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  accent: "#008060",
  danger: "#D72C0D",
  cardShadow: "0 0 0 1px #E1E3E5",
  inputBg: "#FFFFFF",
  inputBorder: "#C9CCCF",
};

interface Props {
  locale: string;
  marketId: string | null;
  fallbackFirstPage: WarehouseHistoryPage;
}

export function WarehouseHistoryClient({
  locale,
  marketId,
  fallbackFirstPage,
}: Props) {
  const t = useTranslations("warehouse");
  const isMobile = useIsMobile();
  const { filters, update } = useWarehouseHistoryFiltersUrl();
  const [arrivalCount, setArrivalCount] = useState(0);
  const [searchLocal, setSearchLocal] = useState(filters.q);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  useEffect(() => {
    setSearchLocal(filters.q);
  }, [filters.q]);

  // Debounce search → URL
  useEffect(() => {
    if (searchLocal === filters.q) return;
    const id = window.setTimeout(() => update({ q: searchLocal }), 250);
    return () => window.clearTimeout(id);
  }, [searchLocal, filters.q, update]);

  // Reset to page 0 when filters change
  const filterKey = `${filters.kind}-${filters.q}-${filters.dateFrom ?? ""}-${filters.dateTo ?? ""}`;
  useEffect(() => {
    setCurrentPageIndex(0);
  }, [filterKey]);

  const { pages, hasMore, loadingMore, mutate, isLoading, size, setSize } =
    useWarehouseList({
      filters,
      fallbackFirstPage,
    });

  useWarehouseRealtime({
    marketId,
    page: "history",
    onNewArrival: () => setArrivalCount((c) => c + 1),
  });

  const displayRows = useMemo(
    () => pages[currentPageIndex]?.rows ?? [],
    [pages, currentPageIndex],
  );

  const hasFetchedNextPage = currentPageIndex + 1 < pages.length;
  const hasNextPage = hasFetchedNextPage || hasMore;
  const isPageLoading = currentPageIndex >= pages.length && loadingMore;

  const handleNextPage = () => {
    const next = currentPageIndex + 1;
    if (!hasFetchedNextPage) {
      setSize(size + 1);
    }
    setCurrentPageIndex(next);
  };

  const handlePrevPage = () => {
    setCurrentPageIndex((i) => Math.max(0, i - 1));
  };

  const hasFilters = hasActiveWarehouseHistoryFilters(filters);

  return (
    <div
      style={{
        padding: isMobile ? "16px 16px 80px" : "24px 32px 80px",
        background: D.pageBg,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1
          style={{
            fontSize: isMobile ? 18 : 22,
            fontWeight: 600,
            color: D.textPrimary,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {t("history.title")}
        </h1>
      </div>

      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => {
          setArrivalCount(0);
          mutate();
        }}
        onDismiss={() => setArrivalCount(0)}
        labels={{
          reveal: t("banner.newReveal"),
          dismiss: t("banner.dismiss"),
        }}
      />

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {/* Kind tabs */}
        <div
          role="tablist"
          aria-label={t("history.filter.ariaLabel")}
          style={{
            display: "inline-flex",
            border: `1px solid ${D.border}`,
            borderRadius: 9999,
            background: D.cardBg,
            padding: 3,
            gap: 2,
          }}
        >
          {WAREHOUSE_HISTORY_KINDS.map((k) => {
            const active = filters.kind === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => update({ kind: k as WarehouseHistoryKind })}
                style={{
                  padding: "6px 14px",
                  border: "none",
                  borderRadius: 9999,
                  background: active ? "#1A1A1A" : "transparent",
                  color: active ? "#FFFFFF" : D.textSecondary,
                  fontSize: 13,
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer",
                  transition: "background-color 120ms ease, color 120ms ease",
                  fontFamily: "inherit",
                  minHeight: 36,
                  whiteSpace: "nowrap",
                }}
              >
                {t(`history.filter.${k}`)}
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div
          style={{
            flex: 1,
            minWidth: 200,
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingInline: 12,
            border: `1px solid ${D.inputBorder}`,
            borderRadius: 8,
            background: D.inputBg,
            minHeight: 40,
          }}
        >
          <Search size={14} strokeWidth={1.5} color={D.textSecondary} aria-hidden="true" />
          <input
            type="search"
            value={searchLocal}
            onChange={(e) => setSearchLocal(e.target.value)}
            placeholder={t("history.filter.searchPlaceholder")}
            aria-label={t("history.filter.searchPlaceholder")}
            style={{
              flex: 1,
              padding: "8px 0",
              fontSize: 13,
              border: "none",
              outline: "none",
              background: "transparent",
              color: D.textPrimary,
            }}
          />
        </div>

        {/* Date range */}
        {!isMobile && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: D.textSecondary,
              flexWrap: "wrap",
            }}
          >
            <span>{t("history.filters.from")}</span>
            <input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) => update({ dateFrom: e.target.value || null })}
              style={{
                padding: "6px 8px",
                border: `1px solid ${D.inputBorder}`,
                borderRadius: 6,
                fontSize: 13,
                color: D.textPrimary,
                backgroundColor: D.inputBg,

                fontFamily: "inherit",
              }}
            />
            <span>{t("history.filters.to")}</span>
            <input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) => update({ dateTo: e.target.value || null })}
              style={{
                padding: "6px 8px",
                border: `1px solid ${D.inputBorder}`,
                borderRadius: 6,
                fontSize: 13,
                color: D.textPrimary,
                backgroundColor: D.inputBg,

                fontFamily: "inherit",
              }}
            />
          </div>
        )}
      </div>

      {/* Mobile date inputs */}
      {isMobile && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: D.textSecondary }}>{t("history.filters.from")}</span>
          <input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(e) => update({ dateFrom: e.target.value || null })}
            style={{
              flex: 1,
              padding: "6px 8px",
              border: `1px solid ${D.inputBorder}`,
              borderRadius: 6,
              fontSize: 13,
              color: D.textPrimary,
              backgroundColor: D.inputBg,
              colorScheme: "dark",
              fontFamily: "inherit",
            }}
          />
          <span style={{ fontSize: 12, color: D.textSecondary }}>{t("history.filters.to")}</span>
          <input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(e) => update({ dateTo: e.target.value || null })}
            style={{
              flex: 1,
              padding: "6px 8px",
              border: `1px solid ${D.inputBorder}`,
              borderRadius: 6,
              fontSize: 13,
              color: D.textPrimary,
              backgroundColor: D.inputBg,
              colorScheme: "dark",
              fontFamily: "inherit",
            }}
          />
        </div>
      )}

      {/* Active filter chips */}
      {hasFilters ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {filters.kind !== "all" ? (
            <FilterChip
              label={`${t("history.chips.kind")}: ${t(`history.filter.${filters.kind}`)}`}
              onRemove={() => update(clearWarehouseHistoryField(filters, "kind"))}
              removeLabel={t("history.chips.remove")}
            />
          ) : null}
          {filters.dateFrom || filters.dateTo ? (
            <FilterChip
              label={`${t("history.chips.date")}: ${filters.dateFrom ?? "…"} — ${filters.dateTo ?? "…"}`}
              onRemove={() => update(clearWarehouseHistoryField(filters, "date"))}
              removeLabel={t("history.chips.remove")}
            />
          ) : null}
          {filters.q ? (
            <FilterChip
              label={`${t("history.chips.search")}: ${filters.q}`}
              onRemove={() => update(clearWarehouseHistoryField(filters, "q"))}
              removeLabel={t("history.chips.remove")}
            />
          ) : null}
          <button
            type="button"
            onClick={() => update({ kind: "all", dateFrom: null, dateTo: null, q: "" })}
            style={{
              marginInlineStart: 4,
              background: "none",
              border: "none",
              color: "#2C6ECB",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("history.chips.clearAll")}
          </button>
        </div>
      ) : null}

      {/* Empty state */}
      {displayRows.length === 0 && !isLoading && !isPageLoading ? (
        <div
          style={{
            padding: 48,
            textAlign: "center",
            color: D.textSecondary,
            fontSize: 14,
            border: `1px dashed ${D.border}`,
            borderRadius: 10,
            backgroundColor: D.cardBg,
          }}
        >
          {t("history.empty")}
        </div>
      ) : (
        <div
          style={{
            backgroundColor: D.cardBg,
            border: `1px solid ${D.border}`,
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: D.cardShadow,
          }}
        >
          {/* Column headers (desktop only) */}
          {!isMobile && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "110px 110px 1fr 180px",
                gap: 12,
                padding: "10px 16px",
                borderBottom: `1px solid ${D.border}`,
                backgroundColor: D.sectionBg,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: D.textSecondary,
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              <span>{t("history.col.kind")}</span>
              <span>{t("history.col.order")}</span>
              <span>{t("history.col.detail")}</span>
              <span style={{ textAlign: "end" }}>{t("history.col.at")}</span>
            </div>
          )}

          {isPageLoading ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: D.textSecondary,
                fontSize: 13,
              }}
            >
              {t("history.loadingMore")}
            </div>
          ) : (
            displayRows.map((e) => (
              <HistoryRow
                key={`${e.kind}-${e.id}`}
                row={e}
                locale={locale}
                isMobile={isMobile}
              >
                {t(`history.kind.${e.kind}`)}
              </HistoryRow>
            ))
          )}

          <WarehousePagination
            page={currentPageIndex}
            pageSize={50}
            totalItems={-1}
            hasNextPage={!loadingMore && hasNextPage}
            hasPrevPage={currentPageIndex > 0}
            onNext={handleNextPage}
            onPrev={handlePrevPage}
            onPageSizeChange={() => {}}
            pageSizeOptions={[]}
            loadingMore={loadingMore && !isPageLoading}
            labelPrev={t("pagination.prev")}
            labelNext={t("pagination.next")}
            labelPage={t("pagination.pageInfoUnknown", { page: currentPageIndex + 1 })}
          />
        </div>
      )}
    </div>
  );
}

const HistoryRow = memo(function HistoryRow({
  row,
  locale,
  isMobile,
  children,
}: {
  row: WarehouseHistoryRow;
  locale: string;
  isMobile: boolean;
  children: React.ReactNode;
}) {
  const color =
    row.kind === "scan"
      ? D.accent
      : row.kind === "return"
        ? row.is_damaged
          ? D.danger
          : D.accent
        : D.textSecondary;

  const KindBadge = (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: 9999,
        color,
        backgroundColor:
          row.kind === "scan"
            ? "#F1F8F5"
            : row.kind === "return"
              ? row.is_damaged
                ? "#FFF4F4"
                : "#F1F8F5"
              : "#F6F6F7",
        border: `1px solid ${
          row.kind === "scan"
            ? "#A7F3D0"
            : row.kind === "return"
              ? row.is_damaged
                ? "#FECACA"
                : "#A7F3D0"
              : "#E1E3E5"
        }`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );

  if (isMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "12px 16px",
          borderBottom: `1px solid ${D.border}`,
          fontSize: 13,
          minHeight: 44,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {KindBadge}
          <code
            style={{
              color: D.textSecondary,
              fontSize: 11,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            {row.order_id ? `#${row.order_id.slice(0, 8)}` : "—"}
          </code>
        </div>
        <span style={{ color: D.textPrimary }}>
          {row.detail}
          {row.is_reprint ? (
            <span
              style={{
                marginInlineStart: 6,
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 999,
                background: "#F6F6F7",
                color: D.textSecondary,
                border: `1px solid ${D.border}`,
              }}
            >
              ↺
            </span>
          ) : null}
        </span>
        <span style={{ color: D.textSecondary, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
          {formatDateTime(row.at, locale)}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 110px 1fr 180px",
        gap: 12,
        padding: "10px 16px",
        borderBottom: `1px solid ${D.border}`,
        fontSize: 13,
        alignItems: "center",
        minHeight: 44,
      }}
    >
      {KindBadge}
      <code
        style={{
          color: D.textSecondary,
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        }}
      >
        {row.order_id ? `#${row.order_id.slice(0, 8)}` : "—"}
      </code>
      <span
        style={{
          color: D.textPrimary,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.detail}
        {row.is_reprint ? (
          <span
            style={{
              marginInlineStart: 6,
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 999,
              background: D.sectionBg,
              color: D.textSecondary,
              border: `1px solid ${D.border}`,
            }}
          >
            ↺
          </span>
        ) : null}
      </span>
      <span
        style={{
          color: D.textSecondary,
          fontSize: 12,
          textAlign: "end",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatDateTime(row.at, locale)}
      </span>
    </div>
  );
});

function FilterChip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px 4px 10px",
        background: D.sectionBg,
        border: `1px solid ${D.border}`,
        borderRadius: 9999,
        fontSize: 12,
        color: D.textPrimary,
      }}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          border: "none",
          background: "transparent",
          color: D.textSecondary,
          cursor: "pointer",
          borderRadius: 4,
          fontFamily: "inherit",
        }}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}
