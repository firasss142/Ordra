"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import type { Locale, Role } from "@/types";
import { useOrdersFiltersUrl } from "@/hooks/useOrdersFiltersUrl";
import { useMarketScope } from "@/context/market-scope";
import { fetcher } from "@/lib/swr-config";
import { useOrdersList, type OrdersListPage, type OrdersListRow } from "@/hooks/useOrdersList";
import { useOrdersRealtime } from "@/hooks/useOrdersRealtime";
import {
  clearFilterField,
  filtersToSearchParams,
  hasActiveFilters,
  resetFilters as resetFiltersFn,
  type ClearableFilterKey,
  type OrderListFilters,
  type PageSize,
} from "@/lib/orders/list-filters";
import { OrdersSearchBar } from "@/components/orders/OrdersSearchBar";
import { OrdersFilterChips } from "@/components/orders/OrdersFilterChips";
import { OrdersFacetBar } from "@/components/orders/OrdersFacetBar";
import type { FacetCounts } from "@/app/api/orders/facet-counts/route";
import { OrdersKpiStrip, type KpiTile } from "@/components/orders/OrdersKpiStrip";
import { filtersForTile, resolveKpiWindow, tileForFilters } from "@/lib/orders/kpi-tiles";
import type { StatusCounts } from "@/app/api/orders/status-counts/route";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { OrdersBulkBar } from "@/components/orders/OrdersBulkBar";
import { BulkUploadPanel } from "@/components/orders/BulkUploadPanel";
import { BulkReopenPanel } from "@/components/orders/BulkReopenPanel";
import { OrdersViewToggle, type OrdersView } from "@/components/orders/OrdersViewToggle";
import { canManuallyDeleteOrderStatus } from "@/lib/order-permissions";

const OrdersAdvancedDrawer = dynamic(
  () => import("@/components/orders/OrdersAdvancedDrawer").then((m) => m.OrdersAdvancedDrawer),
  { ssr: false },
);
const OrderDetailPanel = dynamic(
  () => import("@/components/queue/OrderDetailPanel").then((m) => m.OrderDetailPanel),
  { ssr: false },
);
const CreateOrderModal = dynamic(
  () => import("@/components/orders/CreateOrderModal").then((m) => m.CreateOrderModal),
  { ssr: false },
);
const PostCallActionSheet = dynamic(
  () => import("@/components/queue/PostCallActionSheet").then((m) => m.PostCallActionSheet),
  { ssr: false },
);
const AssignBoard = dynamic(
  () => import("@/components/assign/AssignBoard").then((m) => m.AssignBoard),
  { ssr: false },
);

interface Market {
  id: string;
  name: string;
  code: string;
  currency?: string;
}
interface Agent {
  id: string;
  full_name: string;
  is_active: boolean;
  market_id: string;
}
interface Product {
  id: string;
  name: string;
}
interface Carrier {
  id: string;
  name: string;
}

interface Props {
  role: Role;
  userId: string;
  userMarketId: string;
  userMarketLabel: string;
  userMarketCurrency: string;
  userMarketCode: string;
  locale: Locale;
  fallbackFirstPage: OrdersListPage;
  initialMarketId: string;
  fallbackAgents: Agent[];
}

export function OrdersPageClient({
  role,
  userId,
  userMarketId,
  userMarketLabel,
  userMarketCurrency,
  userMarketCode,
  locale,
  fallbackFirstPage,
  initialMarketId,
  fallbackAgents,
}: Props) {
  const t = useTranslations("orders");
  const isMobile = useIsMobile();

  const isSuperAdmin = role === "super_admin";

  // ---------- Filter state (URL synced) ----------
  const { filters: rawFilters, setFilters, update } = useOrdersFiltersUrl();
  const { scope, marketId: scopeMarketId } = useMarketScope();

  // Sidebar MarketScopeSwitcher is the single source of truth for super_admin.
  // scope === "all" → marketId is null → query returns all markets.
  // Non-super_admin is locked to their own market.
  const filters: OrderListFilters = useMemo(() => {
    const marketId = isSuperAdmin
      ? scope === "all"
        ? null
        : scopeMarketId
      : userMarketId;
    return { ...rawFilters, marketId };
  }, [rawFilters, isSuperAdmin, userMarketId, scope, scopeMarketId]);

  const effectiveMarketId = filters.marketId ?? (isSuperAdmin ? null : userMarketId);

  // ---------- Data sources ----------
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isSuperAdmin ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  const { data: agentsData } = useSWR<{ data: Agent[] }>(
    effectiveMarketId ? `/api/agents?market_id=${effectiveMarketId}` : null,
    fetcher,
    { fallbackData: fallbackAgents.length ? { data: fallbackAgents } : undefined },
  );
  const agents = agentsData?.data ?? [];

  // Warm the product-picker cache so opening an order's "+ Add product" picker
  // is instant. Skipped for super_admin's cross-market scope ("all"): no single
  // market_id to preload — the per-market entry is populated on first detail open.
  useSWR<{ data: unknown[] }>(
    effectiveMarketId
      ? `/api/products/search?market_id=${effectiveMarketId}`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60 * 1000 },
  );

  // Products/carriers lazy — only when Advanced drawer opens
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const { data: productsData, isLoading: productsLoading } = useSWR<{ data: Product[] }>(
    effectiveMarketId ? `/api/products?market_id=${effectiveMarketId}` : null,
    fetcher,
  );
  const { data: carriersData, isLoading: carriersLoading } = useSWR<{ data: Carrier[] }>(
    effectiveMarketId ? `/api/carriers?market_id=${effectiveMarketId}` : null,
    fetcher,
  );
  /**
   * The market's cities, from the cities table rather than from whatever
   * happened to be on screen.
   *
   * The Ville facet used to be built from `rows`, so a page size of 10 offered
   * you five cities out of the market's 144 and silently hid the rest. Cached
   * for five minutes server-side; this list changes about once a year.
   */
  const { data: citiesData, isLoading: citiesLoading } = useSWR<{
    data: { name: string }[];
  }>(
    effectiveMarketId ? `/api/cities?market_id=${effectiveMarketId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000 },
  );

  // Currency picked from selected market
  const currencyCode = useMemo(() => {
    if (filters.marketId) {
      const m = markets.find((m) => m.id === filters.marketId);
      if (m?.currency) return m.currency;
    }
    return userMarketCurrency;
  }, [filters.marketId, markets, userMarketCurrency]);

  // ---------- Orders list (SWR-infinite + keyset) ----------
  const {
    rows,
    total,
    isLoading,
    hasMore,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    currentPage,
    mutate,
    isValidating,
  } = useOrdersList({
    filters,
    // Hydrate fallback for default starting point: manager (no filter) or super_admin on Tunisia default.
    fallbackFirstPage:
      !hasActiveFilters(filters) &&
      ((!isSuperAdmin && !filters.marketId) ||
        (isSuperAdmin && filters.marketId === initialMarketId))
        ? fallbackFirstPage
        : undefined,
  });

  // ---------- Realtime subscription ----------
  const matchFilter = useCallback(
    (row: OrdersListRow) => {
      if (effectiveMarketId && row.market_id !== effectiveMarketId) return false;
      if (!filters.includeDeleted && row.status === "deleted") return false;
      // Preset-level predicates that we can check client-side
      if (filters.preset === "unassigned") {
        return row.status === "pending" && row.assigned_to === null;
      }
      if (filters.preset === "today") {
        const d = new Date(row.created_at);
        const now = new Date();
        return (
          d.getUTCFullYear() === now.getUTCFullYear() &&
          d.getUTCMonth() === now.getUTCMonth() &&
          d.getUTCDate() === now.getUTCDate()
        );
      }
      if (filters.preset === "callbacks") {
        return row.status === "callback_scheduled";
      }
      if (filters.preset === "in_delivery") {
        const deliveryStatuses = ["uploaded", "dispatched", "deposit", "in_transit", "to_be_returned"];
        return deliveryStatuses.includes(row.status);
      }
      // Other filters: include the row and let server revalidation prune if needed
      if (filters.statuses.length > 0 && !filters.statuses.includes(row.status as never)) return false;
      if (filters.agentId === "unassigned" && row.assigned_to !== null) return false;
      if (filters.agentId && filters.agentId !== "unassigned" && row.assigned_to !== filters.agentId) return false;
      return true;
    },
    [effectiveMarketId, filters.includeDeleted, filters.preset, filters.statuses, filters.agentId],
  );
  useOrdersRealtime({
    marketId: effectiveMarketId,
    mutate,
    matchFilter,
  });

  // ---------- Selection ----------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      if (next.size === prev.size) return prev;
      return next;
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

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allOn = ids.every((id) => prev.has(id));
      if (allOn) {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  // ---------- Detail panel + flash highlight ----------
  // Deep-linkable via ?open=<id> (e.g. from alerts or the legacy /orders/[id]
  // redirect). Local state is the source of truth for instant open/close; the
  // URL is kept in sync via history.replaceState so no RSC refetch happens.
  const searchParams = useSearchParams();
  const [openOrderId, setOpenOrderId] = useState<string | null>(
    () => searchParams?.get("open") ?? null,
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openOrderId) {
      if (url.searchParams.get("open") === openOrderId) return;
      url.searchParams.set("open", openOrderId);
    } else {
      if (!url.searchParams.has("open")) return;
      url.searchParams.delete("open");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [openOrderId]);

  // ---------- Unassigned tab view mode (assignment board | plain table) ----------
  const canAssign = isSuperAdmin || role === "market_manager";
  const [view, setView] = useState<OrdersView>(() =>
    searchParams?.get("view") === "table" ? "table" : "board",
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === "table") {
      if (url.searchParams.get("view") === "table") return;
      url.searchParams.set("view", "table");
    } else {
      if (!url.searchParams.has("view")) return;
      url.searchParams.delete("view");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [view]);

  const { mutate: globalMutate } = useSWRConfig();
  const refreshAfterAssign = useCallback(() => {
    void mutate();
    void globalMutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/orders/status-counts") ||
          key.startsWith("/api/orders/unassigned/count")),
    );
  }, [mutate, globalMutate]);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const flashRow = useCallback((id: string) => {
    setHighlightedIds((prev) => prev.has(id) ? prev : new Set(prev).add(id));
    const existing = highlightTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setHighlightedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      highlightTimersRef.current.delete(id);
    }, 2000);
    highlightTimersRef.current.set(id, timer);
  }, []);
  useEffect(() => {
    return () => {
      for (const t of highlightTimersRef.current.values()) clearTimeout(t);
    };
  }, []);

  // ---------- Row cancel ----------
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const handleCancel = useCallback(
    async (id: string) => {
      const note = window.prompt(t("cancelPrompt"));
      if (note === null) return;
      setCancellingId(id);
      try {
        const res = await fetch(`/api/orders/${id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() || "Force cancel" }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setErrorBanner((json as { error?: string }).error ?? t("cancelError"));
          setTimeout(() => setErrorBanner(null), 4000);
        } else {
          await mutate();
        }
      } catch {
        setErrorBanner(t("cancelError"));
        setTimeout(() => setErrorBanner(null), 4000);
      } finally {
        setCancellingId(null);
      }
    },
    [mutate, t],
  );

  const handleRecover = useCallback(
    async (id: string) => {
      if (!window.confirm(t("recoverConfirm"))) return;
      setRecoveringId(id);
      try {
        const res = await fetch(`/api/orders/${id}/recover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setErrorBanner((json as { error?: string }).error ?? t("recoverError"));
          setTimeout(() => setErrorBanner(null), 4000);
        } else {
          await mutate();
        }
      } catch {
        setErrorBanner(t("recoverError"));
        setTimeout(() => setErrorBanner(null), 4000);
      } finally {
        setRecoveringId(null);
      }
    },
    [mutate, t],
  );

  // ---------- Bulk actions ----------
  const handleBulkAssign = useCallback(
    async (agentId: string) => {
      const ids = Array.from(selectedIds);
      const res = await fetch("/api/orders/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: ids, agent_id: agentId }),
      });
      if (res.ok) {
        clearSelection();
        await mutate();
      } else {
        setErrorBanner(t("bulkAssignError"));
        setTimeout(() => setErrorBanner(null), 4000);
      }
    },
    [selectedIds, clearSelection, mutate, t],
  );
  const handleBulkCancel = useCallback(async () => {
    if (!window.confirm(t("bulkCancelConfirm", { count: selectedIds.size }))) return;
    const ids = Array.from(selectedIds);
    const res = await fetch("/api/orders/bulk-cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ids: ids }),
    });
    if (res.ok) {
      clearSelection();
      await mutate();
    } else {
      const json = await res.json().catch(() => ({}));
      setErrorBanner((json as { error?: string }).error ?? t("bulkCancelError"));
      setTimeout(() => setErrorBanner(null), 4000);
    }
  }, [selectedIds, clearSelection, mutate, t]);

  // ---------- Filter patch helpers ----------
  const handleClearField = useCallback(
    (key: ClearableFilterKey) => setFilters(clearFilterField(filters, key)),
    [filters, setFilters],
  );
  const handleClearAll = useCallback(() => setFilters(resetFiltersFn(filters)), [filters, setFilters]);


  // ---------- Create modal ----------
  const [createOpen, setCreateOpen] = useState(false);

  // ---------- Post-call sheet (manager/admin take-over) ----------
  const [callSheet, setCallSheet] = useState<{
    orderId: string;
    status: string;
    marketId: string;
    attemptsCount: number;
  } | null>(null);

  // ---------- CSV Export (preserves current filters) ----------
  const handleExport = useCallback(() => {
    const params = filtersToSearchParams(filters);
    if (effectiveMarketId) params.set("market_id", effectiveMarketId);
    window.location.href = `/api/orders/export?${params.toString()}`;
  }, [effectiveMarketId, filters]);

  // Prefetch detail panel chunk on mount
  useEffect(() => {
    void import("@/components/queue/OrderDetailPanel");
  }, []);

  // Preserve open panel across refreshes
  const fallbackOpenRow = useMemo(
    () => (openOrderId ? rows.find((r) => r.id === openOrderId) ?? null : null),
    [rows, openOrderId],
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );
  const hasBulkDeleteIneligible = selectedRows.some(
    (row) => !canManuallyDeleteOrderStatus(row.status),
  );
  // Reopen acts only on uploaded orders (void shipment → back to confirmed).
  const uploadedSelectedCount = useMemo(
    () => selectedRows.filter((row) => row.status === "uploaded").length,
    [selectedRows],
  );

  const activeMarketLabel = useMemo(() => {
    if (!isSuperAdmin) return userMarketLabel;
    if (!filters.marketId) return t("filters.allMarkets");
    return markets.find((m) => m.id === filters.marketId)?.name ?? "—";
  }, [isSuperAdmin, filters.marketId, markets, userMarketLabel, t]);

  const activeMarketCode = useMemo(() => {
    if (filters.marketId) {
      const code = markets.find((m) => m.id === filters.marketId)?.code;
      if (code) return code;
    }
    return userMarketCode || "TN";
  }, [filters.marketId, markets, userMarketCode]);

  // Quick inline stats derived from loaded rows
  const unassignedCount = rows.filter((r) => r.status === "pending" && r.assigned_to === null).length;
  const callbackCount = rows.filter((r) => r.status === "callback_scheduled").length;

  const hasActiveFilterChips =
    filters.q.length > 0 ||
    filters.statuses.length > 0 ||
    filters.agentId !== null ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.productId !== null ||
    filters.city.length > 0 ||
    filters.totalMin !== null ||
    filters.totalMax !== null ||
    filters.rejectionReason !== null ||
    filters.carrierId !== null;

  // ---------- Facet option counts ----------
  // What each unpicked filter value would return, given everything already
  // applied. Keyed off the same serialization the list request uses, so the two
  // stay in step and SWR dedupes them together.
  const facetCountsKey = useMemo(() => {
    const p = filtersToSearchParams(filters);
    if (effectiveMarketId) p.set("market_id", effectiveMarketId);
    p.delete("limit");
    return `/api/orders/facet-counts?${p.toString()}`;
  }, [filters, effectiveMarketId]);
  const { data: facetCountsData } = useSWR<{ data: FacetCounts }>(
    facetCountsKey,
    fetcher,
    // Kept from the previous filter state while the next lands, so the numbers
    // dim rather than vanish as the user works down the bar.
    { revalidateOnFocus: false, keepPreviousData: true, dedupingInterval: 5_000 },
  );

  // ---------- KPI strip ----------
  // Counts stay independent of every filter except the date range: a tile that
  // moved when you picked an agent could not be trusted as navigation. The date
  // range is the one exception, because the user reads the strip as "how did
  // this period go". Tile <-> filter mapping lives in lib/orders/kpi-tiles.
  const kpiWindow = useMemo(
    () => resolveKpiWindow({ dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
    [filters.dateFrom, filters.dateTo],
  );
  const kpiKey = useMemo(() => {
    const p = new URLSearchParams();
    if (effectiveMarketId) p.set("market_id", effectiveMarketId);
    if (kpiWindow.from) p.set("date_from", kpiWindow.from);
    if (kpiWindow.to) p.set("date_to", kpiWindow.to);
    const qs = p.toString();
    return qs ? `/api/orders/status-counts?${qs}` : "/api/orders/status-counts";
  }, [effectiveMarketId, kpiWindow]);
  const { data: kpiData, isLoading: kpiLoading } = useSWR<{ data: StatusCounts }>(
    kpiKey,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false, keepPreviousData: true },
  );
  const kpiCounts = kpiData?.data;
  const activeTile: KpiTile | null = useMemo(() => tileForFilters(filters), [filters]);

  /**
   * Cities to offer in the Ville facet: the market's canonical list, plus any
   * city actually present on screen that is not in it.
   *
   * The union matters because `orders.customer_city` is free text arriving from
   * three storefronts — a spelling the cities table does not carry would
   * otherwise become unfilterable the moment this stopped reading `rows`.
   */
  const knownCities = useMemo(() => {
    const set = new Set<string>();
    for (const c of citiesData?.data ?? []) if (c.name) set.add(c.name);
    for (const r of rows) if (r.customer_city) set.add(r.customer_city);
    return [...set].sort((a, b) => a.localeCompare(b, locale === "ar" ? "ar" : "fr"));
  }, [citiesData, rows, locale]);

  // Assignment board is the default view of the unassigned tile; any active
  // filter chip falls back to the plain table (filters apply to the table only).
  const boardActive =
    activeTile === "unassigned" && canAssign && view === "board" && !hasActiveFilterChips;

  return (
    <div
      style={{
        padding: isMobile ? "64px 16px 80px" : "24px 24px 80px",
        background: "var(--oms-bg)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            <h1 className="m-0 text-[24px] font-semibold tracking-[-0.017em] text-oms-ink-1">
              {t("title")}
            </h1>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 text-[12.5px] text-oms-ink-2">
              <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-brand" />
              {activeMarketLabel}
              {isValidating ? ` · ${t("refreshing")}` : ""}
            </p>
          </div>

          {/* Primary action lives top-right, not buried inside the filter card. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border border-oms-border bg-oms-surface px-3.5 text-[13px] font-medium text-oms-ink-1 transition-colors duration-fast hover:border-oms-border-strong"
            >
              <Download size={14} strokeWidth={1.75} aria-hidden />
              {t("exportCsv")}
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white shadow-hover-row transition-colors duration-fast hover:bg-brand-hover"
            >
              <Plus size={14} strokeWidth={2.2} aria-hidden />
              {t("create.newOrder")}
            </button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <OrdersKpiStrip
              counts={kpiCounts}
              isLoading={kpiLoading}
              activeTile={activeTile}
              onSelect={(tile) => update(filtersForTile(tile, kpiWindow))}
            />
          </div>
          {activeTile === "unassigned" && canAssign ? (
            <div className="pt-1">
              <OrdersViewToggle
                view={hasActiveFilterChips ? "table" : view}
                onChange={setView}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Filter card ── */}
      <div className="flex flex-col gap-2.5">
        <OrdersSearchBar
          value={filters.q}
          onChange={(q) => update({ q })}
          busy={isValidating}
        />
        {/* Named facets, applied on click. Replaces the "Avancé" drawer for the
            three filters an ops dispatcher reaches for constantly; the panel
            still holds the long tail (product, carrier, price, reason). */}
        <OrdersFacetBar
          filters={filters}
          onChange={update}
          agents={agents}
          products={productsData?.data ?? []}
          carriers={carriersData?.data ?? []}
          cities={knownCities}
          resultCount={total}
          counts={facetCountsData?.data}
          loading={{
            products: productsLoading,
            carriers: carriersLoading,
            cities: citiesLoading,
          }}
        />
        {hasActiveFilterChips ? (
          <OrdersFilterChips
            filters={filters}
            onClearField={handleClearField}
            onClearAll={handleClearAll}
            agentNameLookup={(id) => agents.find((a) => a.id === id)?.full_name ?? null}
            productNameLookup={(id) => productsData?.data.find((p) => p.id === id)?.name ?? null}
          />
        ) : null}
      </div>

      {errorBanner ? (
        <div
          role="alert"
          className="px-3.5 py-2.5 rounded-[8px] text-[13px]"
          style={{ background: "#FFF4F4", color: "#D72C0D", border: "1px solid #F3B9B0" }}
        >
          {errorBanner}
        </div>
      ) : null}

      {boardActive ? (
        <AssignBoard
          marketId={effectiveMarketId ?? "all"}
          marketCode={activeMarketCode}
          onAssigned={refreshAfterAssign}
        />
      ) : (
        <>
      {/* ── Orders table wrapped in card ── */}
      <div className="bg-surface-card border border-line-subtle rounded-[8px] overflow-hidden">
        <OrdersTable
          rows={rows}
          locale={locale}
          currencyCode={currencyCode}
          agents={agents}
          selectedIds={selectedIds}
          highlightedIds={highlightedIds}
          cancellingId={cancellingId}
          recoveringId={recoveringId}
          hasNext={hasNext}
          hasPrev={hasPrev}
          currentPage={currentPage}
          pageSize={filters.pageSize}
          onNextPage={nextPage}
          onPrevPage={prevPage}
          onPageSizeChange={(n) => update({ pageSize: n as PageSize })}
          onOpen={(id) => {
            setOpenOrderId(id);
            flashRow(id);
          }}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onCancel={handleCancel}
          onRecover={canAssign ? handleRecover : undefined}
          onDuplicateChange={() => void mutate()}
          isLoading={isLoading}
          isEmpty={!isLoading && rows.length === 0}
        />
      </div>

      <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: "end" }}>
        {t("footerLive")}
      </div>

      {/* Page level, not inside the table: it is fixed to the viewport, so it
          belongs to the page rather than to the card it acts on. Always
          mounted — it animates itself in and out on the selection. */}
      <OrdersBulkBar
        selectedIds={Array.from(selectedIds)}
        agents={agents.filter((a) => a.is_active)}
        onClearSelection={clearSelection}
        onBulkAssign={handleBulkAssign}
        onBulkCancel={handleBulkCancel}
        onUpload={() => setUploadOpen(true)}
        onReopen={() => setReopenOpen(true)}
        canAssign={canAssign}
        canCancel={canAssign}
        canUpload={canAssign}
        canReopen={canAssign}
        cancelDisabled={hasBulkDeleteIneligible}
        cancelDisabledReason={t("bulk.cancelIneligible")}
      />
        </>
      )}

      {uploadOpen && (
        <BulkUploadPanel
          selectedIds={Array.from(selectedIds)}
          marketId={effectiveMarketId}
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            clearSelection();
            void mutate();
          }}
        />
      )}

      {reopenOpen && (
        <BulkReopenPanel
          selectedIds={Array.from(selectedIds)}
          eligibleCount={uploadedSelectedCount}
          onClose={() => setReopenOpen(false)}
          onDone={() => {
            clearSelection();
            void mutate();
          }}
        />
      )}

      <CreateOrderModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        role={role}
        userMarketId={userMarketId}
        onCreated={() => {
          setCreateOpen(false);
          void mutate();
        }}
      />

      {drawerMounted ? (
        <OrdersAdvancedDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          filters={filters}
          onApply={(patch) => update(patch)}
          products={productsData?.data ?? []}
          carriers={carriersData?.data ?? []}
          agents={agents}
        />
      ) : null}

      <OrderDetailPanel
        key={openOrderId ?? "none"}
        orderId={openOrderId}
        fallbackOrder={fallbackOpenRow as unknown as Record<string, unknown> | null}
        role={role}
        userId={userId}
        onClose={() => setOpenOrderId(null)}
        onCallTerminated={(id, ctx) => {
          setOpenOrderId(null);
          if (ctx) setCallSheet(ctx);
        }}
        onReturnToPool={
          openOrderId
            ? async () => {
                await fetch(`/api/orders/${openOrderId}/assign`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ agent_id: null }),
                });
                setOpenOrderId(null);
                void mutate();
              }
            : undefined
        }
      />

      {callSheet && (
        <PostCallActionSheet
          orderId={callSheet.orderId}
          orderStatus={callSheet.status}
          marketId={callSheet.marketId}
          attemptsCount={callSheet.attemptsCount}
          onClose={() => setCallSheet(null)}
          onSuccess={() => {
            setCallSheet(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

