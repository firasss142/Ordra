"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X, Download, AlertTriangle, SlidersHorizontal } from "lucide-react";
import { useWarehouseList } from "@/hooks/useWarehouseList";
import { useWarehouseHistoryFiltersUrl } from "@/hooks/useWarehouseHistoryFiltersUrl";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatDateTime, formatDayHeader } from "@/lib/format";
import { initialsOf } from "@/lib/user";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { WarehouseShell } from "./shell/WarehouseShell";
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

const ROLE_RING: Record<string, string> = {
  super_admin: "var(--wh-ink-1)",
  market_manager: "var(--wh-scan)",
  warehouse_agent: "var(--wh-ok)",
  agent: "var(--wh-ink-2)",
};

function roleRingColor(role: string | null | undefined): string {
  return role ? (ROLE_RING[role] ?? "var(--wh-ink-2)") : "var(--wh-border-strong)";
}

function formatRoleName(role: string): string {
  return role.replace(/_/g, " ");
}

const KIND_TONE: Record<WarehouseHistoryRow["kind"], BadgeTone> = {
  scan: "success",
  return: "success",
  print: "neutral",
  adjust: "warning",
  writeoff: "critical",
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
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

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

  // Default to flat unless explicitly timeline AND no search/product/anomaly filter
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

  const clearAllFilters = () =>
    update({ kind: "all", dateFrom: null, dateTo: null, q: "", actorId: null, productId: null, onlyAnomalies: false });

  return (
    <WarehouseShell
      title={t("history.title")}
      actions={
        !isMobile ? (
          <a
            href={buildExportUrl("csv")}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-ink-primary bg-surface-card border border-line-subtle rounded-md hover:bg-surface-hover transition-colors duration-fast no-underline"
          >
            <Download size={13} strokeWidth={1.5} />
            {t("history.export.csv")}
          </a>
        ) : undefined
      }
    >
      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => { setArrivalCount(0); mutate(); }}
        onDismiss={() => setArrivalCount(0)}
        labels={{ reveal: t("banner.newReveal", { count: arrivalCount }), dismiss: t("banner.dismiss") }}
      />

      {/* Command-bar search */}
      <div className="bg-surface-card border border-line-subtle rounded-card p-3 flex flex-col gap-3">
        <div className="relative">
          <Search
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-secondary pointer-events-none"
          />
          <input
            type="search"
            value={searchLocal}
            onChange={(e) => setSearchLocal(e.target.value)}
            placeholder={t("history.filter.searchPlaceholder")}
            aria-label={t("history.filter.searchPlaceholder")}
            className="w-full h-10 ps-10 pe-3 text-[14px] bg-surface-page border border-line-subtle rounded-md text-ink-primary placeholder:text-ink-secondary"
          />
        </div>

        {/* Kind segmented + view toggle + more filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            role="tablist"
            aria-label={t("history.filter.ariaLabel")}
            className="inline-flex border border-line-subtle rounded-pill bg-surface-page p-0.5 gap-0.5"
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
                  className={[
                    "px-3.5 py-1 text-[13px] rounded-pill transition-colors duration-fast whitespace-nowrap min-h-[28px]",
                    active
                      ? "bg-ink-primary text-white font-bold"
                      : "text-ink-secondary hover:text-ink-primary hover:bg-surface-card",
                  ].join(" ")}
                >
                  {t(`history.filter.${k}`)}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => update({ onlyAnomalies: !filters.onlyAnomalies })}
            title={t("history.filter.anomaliesOnly")}
            className={[
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-md border transition-colors duration-fast whitespace-nowrap min-h-[32px]",
              filters.onlyAnomalies
                ? "border-status-critical bg-status-criticalBg text-status-critical font-semibold"
                : "border-line-subtle bg-surface-card text-ink-secondary hover:text-ink-primary hover:bg-surface-hover",
            ].join(" ")}
          >
            <AlertTriangle size={13} strokeWidth={1.5} />
            {!isMobile && t("history.filter.anomaliesOnly")}
          </button>

          <button
            type="button"
            onClick={() => setMoreFiltersOpen((v) => !v)}
            aria-expanded={moreFiltersOpen}
            className={[
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-md border transition-colors duration-fast min-h-[32px]",
              moreFiltersOpen || filters.dateFrom || filters.dateTo
                ? "border-ink-primary bg-surface-card text-ink-primary font-semibold"
                : "border-line-subtle bg-surface-card text-ink-secondary hover:text-ink-primary hover:bg-surface-hover",
            ].join(" ")}
          >
            <SlidersHorizontal size={13} strokeWidth={1.75} />
            {t("history.filters.from")} / {t("history.filters.to")}
          </button>

          {!isMobile && (
            <div role="group" className="inline-flex border border-line-subtle rounded-md overflow-hidden ms-auto">
              {(["timeline", "flat"] as WarehouseHistoryView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update({ view: v })}
                  className={[
                    "px-3.5 py-1.5 text-[13px] transition-colors duration-fast min-h-[32px]",
                    effectiveView === v
                      ? "bg-ink-primary text-white font-semibold"
                      : "bg-surface-card text-ink-secondary hover:text-ink-primary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  {t(`history.filter.view.${v}`)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Expanded date range row */}
        {moreFiltersOpen && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line-subtle">
            <span className="text-[13px] text-ink-secondary">{t("history.filters.from")}</span>
            <input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) => update({ dateFrom: e.target.value || null })}
              className="px-2 py-1.5 border border-line-subtle rounded-md text-[13px] text-ink-primary bg-surface-card"
            />
            <span className="text-[13px] text-ink-secondary">{t("history.filters.to")}</span>
            <input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) => update({ dateTo: e.target.value || null })}
              className="px-2 py-1.5 border border-line-subtle rounded-md text-[13px] text-ink-primary bg-surface-card"
            />
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="flex flex-wrap gap-1.5 items-center mt-3">
          {filters.kind !== "all" && (
            <FilterChip
              label={`${t("history.chips.kind")}: ${t(`history.filter.${filters.kind}`)}`}
              onRemove={() => update(clearWarehouseHistoryField(filters, "kind"))}
              removeLabel={t("history.chips.remove")}
            />
          )}
          {(filters.dateFrom || filters.dateTo) && (
            <FilterChip
              label={`${t("history.chips.date")}: ${filters.dateFrom ?? "…"} — ${filters.dateTo ?? "…"}`}
              onRemove={() => update(clearWarehouseHistoryField(filters, "date"))}
              removeLabel={t("history.chips.remove")}
            />
          )}
          {filters.q && (
            <FilterChip
              label={`${t("history.chips.search")}: ${filters.q}`}
              onRemove={() => update(clearWarehouseHistoryField(filters, "q"))}
              removeLabel={t("history.chips.remove")}
            />
          )}
          {filters.actorId && (
            <FilterChip
              label={t("history.chips.actor")}
              onRemove={() => update(clearWarehouseHistoryField(filters, "actor"))}
              removeLabel={t("history.chips.remove")}
            />
          )}
          {filters.productId && (
            <FilterChip
              label={t("history.chips.product")}
              onRemove={() => update(clearWarehouseHistoryField(filters, "product"))}
              removeLabel={t("history.chips.remove")}
            />
          )}
          {filters.onlyAnomalies && (
            <FilterChip
              label={t("history.chips.anomalies")}
              onRemove={() => update(clearWarehouseHistoryField(filters, "anomalies"))}
              removeLabel={t("history.chips.remove")}
            />
          )}
          <button
            type="button"
            onClick={clearAllFilters}
            className="ms-1 text-[12px] font-semibold text-status-action hover:underline"
          >
            {t("history.chips.clearAll")}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="mt-3">
        {displayRows.length === 0 && !isLoading && !isPageLoading ? (
          <EmptyState
            hasFilters={hasFilters}
            label={hasFilters ? t("history.empty.filtered") : t("history.empty.noFilters")}
            onClear={hasFilters ? clearAllFilters : undefined}
            clearLabel={t("history.chips.clearAll")}
          />
        ) : (
          <div className="bg-surface-card border border-line-subtle rounded-card overflow-hidden">
            {isPageLoading ? (
              <div className="p-10 text-center text-ink-secondary text-[13px]">
                {t("history.loadingMore")}
              </div>
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
    </WarehouseShell>
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

            <div className="flex items-center gap-2.5 px-4 py-2 bg-surface-hover border-b border-line-subtle text-[12px] text-ink-secondary">
              <ActorAvatar
                name={session.actorName}
                role={session.actorRole}
                size={22}
                onClick={session.actorId ? () => onActorClick(session.actorId!) : undefined}
              />
              <span className="font-semibold text-ink-primary text-[13px]">
                {session.actorName ?? t("history.session.system")}
              </span>
              {session.actorRole && (
                <span className="text-[11px] text-ink-secondary bg-surface-page border border-line-subtle rounded px-1.5 py-px">
                  {formatRoleName(session.actorRole)}
                </span>
              )}
              <span className="ms-auto tabular-nums">{timeRange}</span>
              <span className="text-ink-secondary">·</span>
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
            <JournalRow
              row={row}
              locale={locale}
              isMobile={isMobile}
              compact={false}
              onActorClick={onActorClick}
              onProductClick={onProductClick}
              t={t}
            />
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
  const tone = KIND_TONE[row.kind];

  const stockLine = row.qty_change !== null && row.balance_after !== null
    ? t("history.row.stockChange", {
        qty: row.qty_change > 0 ? `+${row.qty_change}` : String(row.qty_change),
        after: row.balance_after,
      })
    : null;

  const accentBar = hasAnomaly
    ? "border-s-[3px] border-s-status-critical"
    : "border-s-[3px] border-s-transparent";

  return (
    <div
      className={`relative flex items-start ${isMobile ? "gap-2.5" : "gap-3.5"} px-4 ${compact ? "py-2.5" : "py-3"} border-b border-line-subtle min-h-[48px] hover:bg-surface-hover transition-colors duration-fast ${accentBar}`}
    >
      {!compact && (
        <ActorAvatar
          name={row.actor?.full_name ?? null}
          role={row.actor?.role ?? null}
          size={36}
          onClick={row.actor ? () => onActorClick(row.actor!.id) : undefined}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          {!compact && (
            <span className="font-semibold text-[13px] text-ink-primary">
              {row.actor?.full_name ?? t("history.session.system")}
            </span>
          )}
          {!compact && row.actor?.role && (
            <span className="text-[11px] text-ink-secondary">
              {formatRoleName(row.actor.role)}
            </span>
          )}
          <Badge tone={tone}>
            {t(`history.kind.${row.kind}`)}
            {row.is_reprint ? " ↺" : ""}
          </Badge>
          {hasAnomaly && (
            <span
              aria-label={row.anomalies.map((a) => t(`history.anomaly.${a}`)).join(", ")}
              title={row.anomalies.map((a) => t(`history.anomaly.${a}`)).join(", ")}
              className="text-[10px] text-status-critical font-bold ms-1.5"
            >
              ◤
            </span>
          )}
        </div>

        <div className={`text-[13px] text-ink-primary overflow-hidden text-ellipsis ${isMobile ? "" : "whitespace-nowrap"}`}>
          {row.order_number && (
            <span className="tabular-nums">#{row.order_number} · </span>
          )}
          {row.product_name ? (
            <button
              type="button"
              onClick={row.product_id ? () => onProductClick(row.product_id!) : undefined}
              className="bg-transparent border-0 p-0 text-status-action text-[13px] cursor-pointer underline decoration-dotted"
            >
              {row.product_name}
            </button>
          ) : row.detail !== "—" ? row.detail : null}
        </div>

        {(stockLine || row.note) && (
          <div className="text-[12px] text-ink-secondary mt-0.5 tabular-nums">
            {stockLine}
            {stockLine && row.note && " · "}
            {row.note && <span className="italic">{row.note}</span>}
          </div>
        )}
      </div>

      <span className="text-[12px] text-ink-secondary tabular-nums whitespace-nowrap mt-0.5">
        {formatDateTime(row.at, locale)}
      </span>
    </div>
  );
});

// ─── Day Separator ────────────────────────────────────────────────────────────

function DaySeparator({ date, locale }: { date: string; locale: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 border-b border-line-subtle bg-surface-card">
      <div className="flex-1 h-px bg-line-subtle" />
      <span className="text-[11px] font-semibold text-ink-secondary tracking-[0.04em] uppercase whitespace-nowrap">
        {formatDayHeader(date, locale)}
      </span>
      <div className="flex-1 h-px bg-line-subtle" />
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
    <span style={{ fontSize: Math.floor(size * 0.45), color: "var(--wh-border-strong)" }}>⏱</span>
  ) : (
    <span style={{ fontSize: Math.floor(size * 0.38) }} className="font-bold text-white tracking-[0.02em]">
      {initials}
    </span>
  );

  const style: React.CSSProperties = {
    width: size,
    height: size,
    background: isSystem ? "var(--wh-bg)" : ringColor,
    border: isSystem ? "2px dashed var(--wh-border-strong)" : `2px solid ${ringColor}`,
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={style}
        className="rounded-full flex items-center justify-center shrink-0 cursor-pointer p-0"
        aria-label={name ?? "System"}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      style={style}
      role="img"
      aria-label={name ?? "System"}
      className="rounded-full flex items-center justify-center shrink-0"
    >
      {inner}
    </div>
  );
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
    <div className="px-12 py-12 text-center text-ink-secondary text-[14px] border border-dashed border-line-subtle rounded-card bg-surface-card">
      <div>{label}</div>
      {hasFilters && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 bg-transparent border-0 text-status-action text-[13px] font-semibold cursor-pointer hover:underline"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────

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
    <span className="inline-flex items-center gap-1.5 ps-2.5 pe-1 py-1 bg-surface-card border border-line-subtle rounded-pill text-[12px] text-ink-primary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-ink-secondary hover:bg-surface-hover hover:text-ink-primary transition-colors duration-fast"
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}
