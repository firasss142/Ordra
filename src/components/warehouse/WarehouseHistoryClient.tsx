"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X, Download, AlertTriangle } from "lucide-react";
import { useWarehouseList } from "@/hooks/useWarehouseList";
import { useWarehouseHistoryFiltersUrl } from "@/hooks/useWarehouseHistoryFiltersUrl";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatDateTime, formatDayHeader } from "@/lib/format";
import { initialsOf } from "@/lib/user";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import { WarehousePagination } from "./WarehousePagination";
import {
  WAREHOUSE_HISTORY_KINDS,
  hasActiveWarehouseHistoryFilters,
  clearWarehouseHistoryField,
  type WarehouseHistoryKind,
  type WarehouseHistoryView,
} from "@/lib/warehouse/list-filters";
import { groupRowsIntoSessions, rowDay } from "@/lib/warehouse/group-by-session";
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
  warning: "#B98900",
  action: "#2C6ECB",
  cardShadow: "0 0 0 1px #E1E3E5",
  inputBg: "#FFFFFF",
  inputBorder: "#C9CCCF",
};

const ROLE_RING: Record<string, string> = {
  super_admin: "#1A1A1A",
  market_manager: "#2C6ECB",
  warehouse_agent: "#008060",
  agent: "#6D7175",
};

function roleRingColor(role: string | null | undefined): string {
  return role ? (ROLE_RING[role] ?? "#6D7175") : "#C9CCCF";
}

function formatRoleName(role: string): string {
  return role.replace(/_/g, " ");
}

const KIND_COLORS: Record<WarehouseHistoryRow["kind"], { color: string; bg: string; border: string }> = {
  scan: { color: "#008060", bg: "#F1F8F5", border: "#A7F3D0" },
  return: { color: "#008060", bg: "#F1F8F5", border: "#A7F3D0" },
  print: { color: "#6D7175", bg: "#F6F6F7", border: "#E1E3E5" },
  adjust: { color: "#B98900", bg: "#FFF8E6", border: "#FFD970" },
  writeoff: { color: "#D72C0D", bg: "#FFF4F4", border: "#FECACA" },
};

interface Props {
  locale: string;
  marketId: string | null;
  fallbackFirstPage: WarehouseHistoryPage;
}

export function WarehouseHistoryClient({ locale, marketId, fallbackFirstPage }: Props) {
  const t = useTranslations("warehouse");
  const isMobile = useIsMobile();
  const { filters, update } = useWarehouseHistoryFiltersUrl();
  const [arrivalCount, setArrivalCount] = useState(0);
  const [searchLocal, setSearchLocal] = useState(filters.q);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  useEffect(() => { setSearchLocal(filters.q); }, [filters.q]);

  useEffect(() => {
    if (searchLocal === filters.q) return;
    const id = window.setTimeout(() => update({ q: searchLocal, view: "flat" }), 250);
    return () => window.clearTimeout(id);
  }, [searchLocal, filters.q, update]);

  const filterKey = `${filters.kind}-${filters.q}-${filters.dateFrom ?? ""}-${filters.dateTo ?? ""}-${filters.actorId ?? ""}-${filters.productId ?? ""}-${filters.onlyAnomalies}`;
  useEffect(() => { setCurrentPageIndex(0); }, [filterKey]);

  const { pages, hasMore, loadingMore, mutate, isLoading, size, setSize } = useWarehouseList({
    filters,
    fallbackFirstPage,
  });

  useWarehouseRealtime({
    marketId,
    page: "history",
    onNewArrival: () => setArrivalCount((c) => c + 1),
  });

  const displayRows = useMemo(() => pages[currentPageIndex]?.rows ?? [], [pages, currentPageIndex]);

  const hasFetchedNextPage = currentPageIndex + 1 < pages.length;
  const hasNextPage = hasFetchedNextPage || hasMore;
  const isPageLoading = currentPageIndex >= pages.length && loadingMore;

  const handleNextPage = () => {
    const next = currentPageIndex + 1;
    if (!hasFetchedNextPage) setSize(size + 1);
    setCurrentPageIndex(next);
  };
  const handlePrevPage = () => setCurrentPageIndex((i) => Math.max(0, i - 1));

  const hasFilters = hasActiveWarehouseHistoryFilters(filters);

  // Timeline view requires no active search/product/anomaly filter
  const effectiveView: WarehouseHistoryView =
    filters.q || filters.productId || filters.onlyAnomalies ? "flat" : filters.view;

  const sessions = useMemo(
    () => effectiveView === "timeline" ? groupRowsIntoSessions(displayRows) : null,
    [displayRows, effectiveView],
  );

  const buildExportUrl = (format: "csv") => {
    const params = new URLSearchParams();
    if (filters.kind !== "all") params.set("kind", filters.kind);
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    if (filters.q) params.set("q", filters.q);
    if (filters.actorId) params.set("actor_id", filters.actorId);
    if (filters.productId) params.set("product_id", filters.productId);
    if (filters.onlyAnomalies) params.set("anomalies", "1");
    return `/api/warehouse/history/export.${format}?${params.toString()}`;
  };

  return (
    <div style={{ padding: isMobile ? "16px 16px 80px" : "24px 32px 80px", background: D.pageBg, minHeight: "100vh", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 600, color: D.textPrimary, margin: 0, letterSpacing: "-0.01em" }}>
          {t("history.title")}
        </h1>
        {!isMobile && (
          <div style={{ display: "flex", gap: 8 }}>
            <a
              href={buildExportUrl("csv")}
              download
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", border: `1px solid ${D.border}`, borderRadius: 8, background: D.cardBg, color: D.textPrimary, fontSize: 13, fontWeight: 500, textDecoration: "none", cursor: "pointer" }}
            >
              <Download size={13} strokeWidth={1.5} />
              {t("history.export.csv")}
            </a>
          </div>
        )}
      </div>

      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => { setArrivalCount(0); mutate(); }}
        onDismiss={() => setArrivalCount(0)}
        labels={{ reveal: t("banner.newReveal"), dismiss: t("banner.dismiss") }}
      />

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {/* Kind tabs */}
        <div role="tablist" aria-label={t("history.filter.ariaLabel")} style={{ display: "inline-flex", border: `1px solid ${D.border}`, borderRadius: 9999, background: D.cardBg, padding: 3, gap: 2 }}>
          {WAREHOUSE_HISTORY_KINDS.map((k) => {
            const active = filters.kind === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => update({ kind: k as WarehouseHistoryKind })}
                style={{ padding: "6px 14px", border: "none", borderRadius: 9999, background: active ? "#1A1A1A" : "transparent", color: active ? "#FFFFFF" : D.textSecondary, fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer", transition: "background-color 120ms ease, color 120ms ease", fontFamily: "inherit", minHeight: 36, whiteSpace: "nowrap" }}
              >
                {t(`history.filter.${k}`)}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ flex: 1, minWidth: 200, display: "flex", alignItems: "center", gap: 8, paddingInline: 12, border: `1px solid ${D.inputBorder}`, borderRadius: 8, background: D.inputBg, minHeight: 40 }}>
          <Search size={14} strokeWidth={1.5} color={D.textSecondary} aria-hidden="true" />
          <input
            type="search"
            value={searchLocal}
            onChange={(e) => setSearchLocal(e.target.value)}
            placeholder={t("history.filter.searchPlaceholder")}
            aria-label={t("history.filter.searchPlaceholder")}
            style={{ flex: 1, padding: "8px 0", fontSize: 13, border: "none", outline: "none", background: "transparent", color: D.textPrimary }}
          />
        </div>

        {/* Anomaly toggle */}
        <button
          type="button"
          onClick={() => update({ onlyAnomalies: !filters.onlyAnomalies })}
          title={t("history.filter.anomaliesOnly")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: `1px solid ${filters.onlyAnomalies ? D.danger : D.border}`, borderRadius: 8, background: filters.onlyAnomalies ? "#FFF4F4" : D.cardBg, color: filters.onlyAnomalies ? D.danger : D.textSecondary, fontSize: 13, fontWeight: filters.onlyAnomalies ? 600 : 400, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", minHeight: 40 }}
        >
          <AlertTriangle size={13} strokeWidth={1.5} />
          {!isMobile && t("history.filter.anomaliesOnly")}
        </button>

        {/* View toggle */}
        {!isMobile && (
          <div role="group" style={{ display: "inline-flex", border: `1px solid ${D.border}`, borderRadius: 8, overflow: "hidden" }}>
            {(["timeline", "flat"] as WarehouseHistoryView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => update({ view: v })}
                style={{ padding: "7px 14px", border: "none", background: effectiveView === v ? "#1A1A1A" : D.cardBg, color: effectiveView === v ? "#FFFFFF" : D.textSecondary, fontSize: 13, fontWeight: effectiveView === v ? 600 : 400, cursor: "pointer", fontFamily: "inherit", minHeight: 36 }}
              >
                {t(`history.filter.view.${v}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Date range */}
      <div style={{ display: "flex", gap: isMobile ? 8 : 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: isMobile ? 12 : 13, color: D.textSecondary }}>{t("history.filters.from")}</span>
        <input type="date" value={filters.dateFrom ?? ""} onChange={(e) => update({ dateFrom: e.target.value || null })} style={{ padding: "6px 8px", border: `1px solid ${D.inputBorder}`, borderRadius: 6, fontSize: 13, color: D.textPrimary, backgroundColor: D.inputBg, fontFamily: "inherit" }} />
        <span style={{ fontSize: isMobile ? 12 : 13, color: D.textSecondary }}>{t("history.filters.to")}</span>
        <input type="date" value={filters.dateTo ?? ""} onChange={(e) => update({ dateTo: e.target.value || null })} style={{ padding: "6px 8px", border: `1px solid ${D.inputBorder}`, borderRadius: 6, fontSize: 13, color: D.textPrimary, backgroundColor: D.inputBg, fontFamily: "inherit" }} />
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {filters.kind !== "all" && (
            <FilterChip label={`${t("history.chips.kind")}: ${t(`history.filter.${filters.kind}`)}`} onRemove={() => update(clearWarehouseHistoryField(filters, "kind"))} removeLabel={t("history.chips.remove")} />
          )}
          {(filters.dateFrom || filters.dateTo) && (
            <FilterChip label={`${t("history.chips.date")}: ${filters.dateFrom ?? "…"} — ${filters.dateTo ?? "…"}`} onRemove={() => update(clearWarehouseHistoryField(filters, "date"))} removeLabel={t("history.chips.remove")} />
          )}
          {filters.q && (
            <FilterChip label={`${t("history.chips.search")}: ${filters.q}`} onRemove={() => update(clearWarehouseHistoryField(filters, "q"))} removeLabel={t("history.chips.remove")} />
          )}
          {filters.actorId && (
            <FilterChip label={t("history.chips.actor")} onRemove={() => update(clearWarehouseHistoryField(filters, "actor"))} removeLabel={t("history.chips.remove")} />
          )}
          {filters.productId && (
            <FilterChip label={t("history.chips.product")} onRemove={() => update(clearWarehouseHistoryField(filters, "product"))} removeLabel={t("history.chips.remove")} />
          )}
          {filters.onlyAnomalies && (
            <FilterChip label={t("history.chips.anomalies")} onRemove={() => update(clearWarehouseHistoryField(filters, "anomalies"))} removeLabel={t("history.chips.remove")} />
          )}
          <button type="button" onClick={() => update({ kind: "all", dateFrom: null, dateTo: null, q: "", actorId: null, productId: null, onlyAnomalies: false })} style={{ marginInlineStart: 4, background: "none", border: "none", color: "#2C6ECB", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {t("history.chips.clearAll")}
          </button>
        </div>
      )}

      {/* Content */}
      {displayRows.length === 0 && !isLoading && !isPageLoading ? (
        <EmptyState hasFilters={hasFilters} label={hasFilters ? t("history.empty.filtered") : t("history.empty.noFilters")} onClear={hasFilters ? () => update({ kind: "all", dateFrom: null, dateTo: null, q: "", actorId: null, productId: null, onlyAnomalies: false }) : undefined} clearLabel={t("history.chips.clearAll")} />
      ) : (
        <div style={{ backgroundColor: D.cardBg, border: `1px solid ${D.border}`, borderRadius: 10, overflow: "hidden", boxShadow: D.cardShadow }}>
          {isPageLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: D.textSecondary, fontSize: 13 }}>{t("history.loadingMore")}</div>
          ) : effectiveView === "timeline" && sessions ? (
            <TimelineView
              sessions={sessions}
              locale={locale}
              isMobile={isMobile}
              onActorClick={(actorId) => update({ actorId, view: "flat" })}
              onProductClick={(productId) => update({ productId, view: "flat" })}
              t={t}
            />
          ) : (
            <FlatView
              rows={displayRows}
              locale={locale}
              isMobile={isMobile}
              onActorClick={(actorId) => update({ actorId, view: "flat" })}
              onProductClick={(productId) => update({ productId, view: "flat" })}
              t={t}
            />
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

// ─── Timeline View ────────────────────────────────────────────────────────────

function TimelineView({
  sessions,
  locale,
  isMobile,
  onActorClick,
  onProductClick,
  t,
}: {
  sessions: ReturnType<typeof groupRowsIntoSessions>;
  locale: string;
  isMobile: boolean;
  onActorClick: (id: string) => void;
  onProductClick: (id: string) => void;
  t: ReturnType<typeof useTranslations<"warehouse">>;
}) {
  let lastDay: string | null = null;

  return (
    <>
      {sessions.map((session) => {
        const sessionDay = rowDay(session.startAt);
        const showDaySep = sessionDay !== lastDay;
        lastDay = sessionDay;

        const summaryParts: string[] = [];
        if (session.scanCount > 0) summaryParts.push(t("history.session.scans", { count: session.scanCount }));
        if (session.returnCount > 0) summaryParts.push(t("history.session.returns", { count: session.returnCount }));
        if (session.printCount > 0) summaryParts.push(t("history.session.prints", { count: session.printCount }));
        if (session.adjustCount > 0) summaryParts.push(t("history.session.adjusts", { count: session.adjustCount }));

        const startTime = new Date(session.startAt);
        const endTime = new Date(session.endAt);
        const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const timeRange = session.startAt === session.endAt ? hhmm(startTime) : `${hhmm(endTime)} – ${hhmm(startTime)}`;

        return (
          <div key={session.sessionKey}>
            {showDaySep && <DaySeparator date={session.startAt} locale={locale} />}

            {/* Session header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#F9F9F9", borderBottom: `1px solid ${D.border}`, fontSize: 12, color: D.textSecondary }}>
              <ActorAvatar
                name={session.actorName}
                role={session.actorRole}
                size={22}
                onClick={session.actorId ? () => onActorClick(session.actorId!) : undefined}
              />
              <span style={{ fontWeight: 600, color: D.textPrimary, fontSize: 13 }}>
                {session.actorName ?? t("history.session.system")}
              </span>
              {session.actorRole && (
                <span style={{ fontSize: 11, color: D.textSecondary, background: D.sectionBg, border: `1px solid ${D.border}`, borderRadius: 4, padding: "1px 6px" }}>
                  {formatRoleName(session.actorRole)}
                </span>
              )}
              <span style={{ marginInlineStart: "auto", fontVariantNumeric: "tabular-nums" }}>{timeRange}</span>
              <span style={{ color: D.textSecondary }}>·</span>
              <span>{summaryParts.join(", ")}</span>
            </div>

            {session.rows.map((row) => (
              <JournalRow
                key={`${row.kind}-${row.id}`}
                row={row}
                locale={locale}
                isMobile={isMobile}
                compact
                onActorClick={onActorClick}
                onProductClick={onProductClick}
                t={t}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

// ─── Flat View ────────────────────────────────────────────────────────────────

function FlatView({
  rows,
  locale,
  isMobile,
  onActorClick,
  onProductClick,
  t,
}: {
  rows: WarehouseHistoryRow[];
  locale: string;
  isMobile: boolean;
  onActorClick: (id: string) => void;
  onProductClick: (id: string) => void;
  t: ReturnType<typeof useTranslations<"warehouse">>;
}) {
  let lastDay: string | null = null;
  return (
    <>
      {rows.map((row) => {
        const day = rowDay(row.at);
        const showDaySep = day !== lastDay;
        lastDay = day;
        return (
          <div key={`${row.kind}-${row.id}`}>
            {showDaySep && <DaySeparator date={row.at} locale={locale} />}
            <JournalRow row={row} locale={locale} isMobile={isMobile} compact={false} onActorClick={onActorClick} onProductClick={onProductClick} t={t} />
          </div>
        );
      })}
    </>
  );
}

// ─── Journal Row ──────────────────────────────────────────────────────────────

const JournalRow = memo(function JournalRow({
  row,
  locale,
  isMobile,
  compact,
  onActorClick,
  onProductClick,
  t,
}: {
  row: WarehouseHistoryRow;
  locale: string;
  isMobile: boolean;
  compact: boolean;
  onActorClick: (id: string) => void;
  onProductClick: (id: string) => void;
  t: ReturnType<typeof useTranslations<"warehouse">>;
}) {
  const hasAnomaly = row.anomalies.length > 0;
  const kindColors = KIND_COLORS[row.kind];

  const kindLabel = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 9999, color: kindColors.color, backgroundColor: kindColors.bg, border: `1px solid ${kindColors.border}`, whiteSpace: "nowrap" }}>
      {t(`history.kind.${row.kind}`)}
      {row.is_reprint && <span style={{ fontSize: 9 }}>↺</span>}
    </span>
  );

  // Action sentence: e.g. "Scanned out #A1B2 · Printemps Rose · Anis M."
  const stockLine = row.qty_change !== null && row.balance_after !== null
    ? t("history.row.stockChange", { qty: row.qty_change > 0 ? `+${row.qty_change}` : String(row.qty_change), after: row.balance_after })
    : null;

  const anomalyBadge = hasAnomaly ? (
    <span
      aria-label={row.anomalies.map((a) => t(`history.anomaly.${a}`)).join(", ")}
      title={row.anomalies.map((a) => t(`history.anomaly.${a}`)).join(", ")}
      style={{ fontSize: 10, color: D.danger, fontWeight: 700, marginInlineStart: 6 }}
    >
      ◤
    </span>
  ) : null;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: isMobile ? 10 : 14,
        padding: compact ? "10px 16px" : "12px 16px",
        borderBottom: `1px solid ${D.border}`,
        borderInlineStart: hasAnomaly ? `3px solid ${D.danger}` : "3px solid transparent",
        minHeight: 48,
      }}
    >
      {/* Avatar */}
      {!compact && (
        <ActorAvatar
          name={row.actor?.full_name ?? null}
          role={row.actor?.role ?? null}
          size={36}
          onClick={row.actor ? () => onActorClick(row.actor!.id) : undefined}
        />
      )}

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Line 1: actor name + kind pill + anomaly */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
          {!compact && (
            <span style={{ fontWeight: 600, fontSize: 13, color: D.textPrimary }}>
              {row.actor?.full_name ?? t("history.session.system")}
            </span>
          )}
          {!compact && row.actor?.role && (
            <span style={{ fontSize: 11, color: D.textSecondary }}>{formatRoleName(row.actor.role)}</span>
          )}
          {kindLabel}
          {anomalyBadge}
        </div>

        {/* Line 2: detail sentence */}
        <div style={{ fontSize: 13, color: D.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isMobile ? "normal" : "nowrap" }}>
          {row.order_number && <span style={{ fontVariantNumeric: "tabular-nums" }}>#{row.order_number} · </span>}
          {row.product_name ? (
            <button
              type="button"
              onClick={row.product_id ? () => onProductClick(row.product_id!) : undefined}
              style={{ background: "none", border: "none", padding: 0, color: D.action, fontSize: 13, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textDecorationStyle: "dotted" }}
            >
              {row.product_name}
            </button>
          ) : row.detail !== "—" ? row.detail : null}
        </div>

        {/* Line 3: stock change + note */}
        {(stockLine || row.note) && (
          <div style={{ fontSize: 12, color: D.textSecondary, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {stockLine}
            {stockLine && row.note && " · "}
            {row.note && <span style={{ fontStyle: "italic" }}>{row.note}</span>}
          </div>
        )}
      </div>

      {/* Trailing: timestamp */}
      <span style={{ fontSize: 12, color: D.textSecondary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", marginTop: 1 }}>
        {formatDateTime(row.at, locale)}
      </span>
    </div>
  );
});

// ─── Day Separator ────────────────────────────────────────────────────────────

function DaySeparator({ date, locale }: { date: string; locale: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: `1px solid ${D.border}` }}>
      <div style={{ flex: 1, height: 1, background: D.border }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: D.textSecondary, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {formatDayHeader(date, locale)}
      </span>
      <div style={{ flex: 1, height: 1, background: D.border }} />
    </div>
  );
}

// ─── Actor Avatar ─────────────────────────────────────────────────────────────

function ActorAvatar({
  name,
  role,
  size,
  onClick,
}: {
  name: string | null;
  role: string | null | undefined;
  size: number;
  onClick?: () => void;
}) {
  const initials = initialsOf({ full_name: name });
  const ringColor = roleRingColor(role);
  const isSystem = !name && !role;

  const inner = isSystem ? (
    <span style={{ fontSize: Math.floor(size * 0.45), color: "#C9CCCF" }}>⏱</span>
  ) : (
    <span style={{ fontSize: Math.floor(size * 0.38), fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.02em" }}>{initials}</span>
  );

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    background: isSystem ? "#F6F6F7" : ringColor,
    border: isSystem ? `2px dashed #C9CCCF` : `2px solid ${ringColor}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    cursor: onClick ? "pointer" : "default",
  };

  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ ...style, padding: 0, fontFamily: "inherit" }} aria-label={name ?? "System"}>
        {inner}
      </button>
    );
  }
  return <div style={style} role="img" aria-label={name ?? "System"}>{inner}</div>;
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  hasFilters,
  label,
  onClear,
  clearLabel,
}: {
  hasFilters: boolean;
  label: string;
  onClear?: () => void;
  clearLabel: string;
}) {
  return (
    <div style={{ padding: 48, textAlign: "center", color: D.textSecondary, fontSize: 14, border: `1px dashed ${D.border}`, borderRadius: 10, backgroundColor: D.cardBg }}>
      <div>{label}</div>
      {hasFilters && onClear && (
        <button type="button" onClick={onClear} style={{ marginTop: 12, background: "none", border: "none", color: "#2C6ECB", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, onRemove, removeLabel }: { label: string; onRemove: () => void; removeLabel: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 10px", background: D.sectionBg, border: `1px solid ${D.border}`, borderRadius: 9999, fontSize: 12, color: D.textPrimary }}>
      {label}
      <button type="button" onClick={onRemove} aria-label={removeLabel} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, border: "none", background: "transparent", color: D.textSecondary, cursor: "pointer", borderRadius: 4, fontFamily: "inherit" }}>
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}

