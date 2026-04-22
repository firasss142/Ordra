"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { useWarehouseList } from "@/hooks/useWarehouseList";
import { useWarehouseHistoryFiltersUrl } from "@/hooks/useWarehouseHistoryFiltersUrl";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import {
  WAREHOUSE_HISTORY_KINDS,
  hasActiveWarehouseHistoryFilters,
  clearWarehouseHistoryField,
  type WarehouseHistoryKind,
} from "@/lib/warehouse/list-filters";
import type { WarehouseHistoryPage, WarehouseHistoryRow } from "@/hooks/useWarehouseList";

interface Props {
  locale: string;
  marketId: string | null;
  fallbackFirstPage: WarehouseHistoryPage;
}

function fmtDateTime(ts: string, locale: string) {
  return new Date(ts).toLocaleString(locale === "ar" ? "ar" : locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WarehouseHistoryClient({
  locale,
  marketId,
  fallbackFirstPage,
}: Props) {
  const t = useTranslations("warehouse");
  const { filters, update } = useWarehouseHistoryFiltersUrl();
  const [arrivalCount, setArrivalCount] = useState(0);
  const [searchLocal, setSearchLocal] = useState(filters.q);

  useEffect(() => {
    setSearchLocal(filters.q);
  }, [filters.q]);

  // Debounce search → URL
  useEffect(() => {
    if (searchLocal === filters.q) return;
    const id = window.setTimeout(
      () => update({ q: searchLocal }),
      250,
    );
    return () => window.clearTimeout(id);
  }, [searchLocal, filters.q, update]);

  const { rows, hasMore, loadingMore, loadMore, mutate, isLoading } =
    useWarehouseList({
      filters,
      fallbackFirstPage,
    });

  useWarehouseRealtime({
    marketId,
    page: "history",
    onNewArrival: () => setArrivalCount((c) => c + 1),
  });

  // Stable ref so the observer is only re-created when hasMore transitions,
  // not on every loadMore identity change (which changes each time size increments).
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore]);

  const hasFilters = hasActiveWarehouseHistoryFilters(filters);

  return (
    <div
      style={{
        padding: "24px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1
          style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}
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

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div
          role="tablist"
          aria-label={t("history.filter.ariaLabel")}
          style={{
            display: "inline-flex",
            border: "1px solid #E1E3E5",
            borderRadius: 9999,
            background: "#FFFFFF",
            padding: 2,
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
                  color: active ? "#FFFFFF" : "#1A1A1A",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition:
                    "background-color 120ms ease, color 120ms ease",
                }}
              >
                {t(`history.filter.${k}`)}
              </button>
            );
          })}
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 220,
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingInline: 12,
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            background: "#FFFFFF",
          }}
        >
          <Search
            size={14}
            strokeWidth={1.5}
            color="#6D7175"
            aria-hidden="true"
          />
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
              color: "#1A1A1A",
            }}
          />
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#6D7175",
          }}
        >
          <span>{t("history.filters.from")}</span>
          <input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(e) =>
              update({ dateFrom: e.target.value || null })
            }
            style={{
              padding: "4px 8px",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: 13,
              color: "#1A1A1A",
            }}
          />
          <span>{t("history.filters.to")}</span>
          <input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(e) =>
              update({ dateTo: e.target.value || null })
            }
            style={{
              padding: "4px 8px",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: 13,
              color: "#1A1A1A",
            }}
          />
        </div>
      </div>

      {hasFilters ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
          }}
        >
          {filters.kind !== "all" ? (
            <FilterChip
              label={`${t("history.chips.kind")}: ${t(
                `history.filter.${filters.kind}`,
              )}`}
              onRemove={() =>
                update(clearWarehouseHistoryField(filters, "kind"))
              }
              removeLabel={t("history.chips.remove")}
            />
          ) : null}
          {filters.dateFrom || filters.dateTo ? (
            <FilterChip
              label={`${t("history.chips.date")}: ${filters.dateFrom ?? "…"} — ${filters.dateTo ?? "…"}`}
              onRemove={() =>
                update(clearWarehouseHistoryField(filters, "date"))
              }
              removeLabel={t("history.chips.remove")}
            />
          ) : null}
          {filters.q ? (
            <FilterChip
              label={`${t("history.chips.search")}: ${filters.q}`}
              onRemove={() =>
                update(clearWarehouseHistoryField(filters, "q"))
              }
              removeLabel={t("history.chips.remove")}
            />
          ) : null}
          <button
            type="button"
            onClick={() =>
              update({ kind: "all", dateFrom: null, dateTo: null, q: "" })
            }
            style={{
              marginInlineStart: 4,
              background: "none",
              border: "none",
              color: "#2C6ECB",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("history.chips.clearAll")}
          </button>
        </div>
      ) : null}

      {rows.length === 0 && !isLoading ? (
        <div
          style={{
            padding: 48,
            textAlign: "center",
            color: "#6D7175",
            fontSize: 14,
            border: "1px dashed #E1E3E5",
            borderRadius: 8,
            backgroundColor: "#FFFFFF",
          }}
        >
          {t("history.empty")}
        </div>
      ) : (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "110px 110px 1fr 180px",
              gap: 12,
              padding: "10px 16px",
              borderBottom: "1px solid #E1E3E5",
              backgroundColor: "#F7F7F7",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#6D7175",
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
          {rows.map((e) => (
            <HistoryRow key={`${e.kind}-${e.id}`} row={e} locale={locale}>
              {t(`history.kind.${e.kind}`)}
            </HistoryRow>
          ))}
          <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
          {loadingMore ? (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                color: "#6D7175",
                fontSize: 13,
              }}
            >
              {t("history.loadingMore")}
            </div>
          ) : null}
          {!hasMore && rows.length > 0 ? (
            <div
              style={{
                padding: "10px 16px",
                textAlign: "center",
                color: "#6D7175",
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {t("history.footerCount", { count: rows.length })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const HistoryRow = memo(function HistoryRow({
  row,
  locale,
  children,
}: {
  row: WarehouseHistoryRow;
  locale: string;
  children: React.ReactNode;
}) {
  const color =
    row.kind === "scan"
      ? "#008060"
      : row.kind === "return"
        ? row.is_damaged
          ? "#D72C0D"
          : "#008060"
        : "#1A1A1A";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 110px 1fr 180px",
        gap: 12,
        padding: "10px 16px",
        borderBottom: "1px solid #F2F2F2",
        fontSize: 13,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.4,
          color,
          textTransform: "uppercase",
        }}
      >
        {children}
      </span>
      <code
        style={{
          color: "#6D7175",
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        }}
      >
        {row.order_id ? `#${row.order_id.slice(0, 8)}` : "—"}
      </code>
      <span
        style={{
          color: "#1A1A1A",
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
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "1px 6px",
              borderRadius: 999,
              background: "#F2F2F2",
              color: "#6D7175",
            }}
          >
            ↺
          </span>
        ) : null}
      </span>
      <span
        style={{
          color: "#6D7175",
          fontSize: 12,
          textAlign: "end",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtDateTime(row.at, locale)}
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
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 9999,
        fontSize: 12,
        color: "#1A1A1A",
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
          width: 18,
          height: 18,
          border: "none",
          background: "transparent",
          color: "#6D7175",
          cursor: "pointer",
          borderRadius: 4,
        }}
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}
