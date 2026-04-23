"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Locale, Role } from "@/types";
import { useOrdersFiltersUrl } from "@/hooks/useOrdersFiltersUrl";
import { fetcher } from "@/lib/swr-config";
import { useOrdersList, type OrdersListPage, type OrdersListRow } from "@/hooks/useOrdersList";
import { useOrdersRealtime } from "@/hooks/useOrdersRealtime";
import {
  DEFAULT_FILTERS,
  clearFilterField,
  filtersToSearchParams,
  hasActiveFilters,
  resetFilters as resetFiltersFn,
  type ClearableFilterKey,
  type OrderListFilters,
} from "@/lib/orders/list-filters";
import { OrdersFilterBar } from "@/components/orders/OrdersFilterBar";
import { OrdersFilterChips } from "@/components/orders/OrdersFilterChips";
import { OrdersPresetPills } from "@/components/orders/OrdersPresetPills";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { OrdersBulkBar } from "@/components/orders/OrdersBulkBar";
import { NewOrdersBanner } from "@/components/orders/NewOrdersBanner";

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
  userMarketId: string;
  userMarketLabel: string;
  userMarketCurrency: string;
  locale: Locale;
  fallbackFirstPage: OrdersListPage;
  initialMarketId: string;
  fallbackAgents: Agent[];
}

export function OrdersPageClient({
  role,
  userMarketId,
  userMarketLabel,
  userMarketCurrency,
  locale,
  fallbackFirstPage,
  initialMarketId,
  fallbackAgents,
}: Props) {
  const t = useTranslations("orders");

  const isSuperAdmin = role === "super_admin";

  // ---------- Filter state (URL synced) ----------
  const { filters: rawFilters, setFilters, update } = useOrdersFiltersUrl();

  // For non-super_admin, force marketId to own market regardless of URL.
  // For super_admin, default to Tunisia when URL has no market set (no URL pollution).
  const filters: OrderListFilters = useMemo(() => {
    if (isSuperAdmin) {
      return rawFilters.marketId ? rawFilters : { ...rawFilters, marketId: initialMarketId };
    }
    return { ...rawFilters, marketId: userMarketId };
  }, [rawFilters, isSuperAdmin, userMarketId, initialMarketId]);

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

  // Products/carriers lazy — only when Advanced drawer opens
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const { data: productsData } = useSWR<{ data: Product[] }>(
    drawerMounted && effectiveMarketId ? `/api/products?market_id=${effectiveMarketId}` : null,
    fetcher,
  );
  const { data: carriersData } = useSWR<{ data: Carrier[] }>(
    drawerMounted && effectiveMarketId ? `/api/carriers?market_id=${effectiveMarketId}` : null,
    fetcher,
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
      // Preset-level predicates that we can check client-side
      if (filters.preset === "unassigned") {
        return row.status === "new" && row.assigned_to === null;
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
      // Other filters: include the row and let server revalidation prune if needed
      if (filters.statuses.length > 0 && !filters.statuses.includes(row.status as never)) return false;
      if (filters.agentId === "unassigned" && row.assigned_to !== null) return false;
      if (filters.agentId && filters.agentId !== "unassigned" && row.assigned_to !== filters.agentId) return false;
      return true;
    },
    [effectiveMarketId, filters.preset, filters.statuses, filters.agentId],
  );
  const { newCount, reveal: revealNew, dismiss: dismissNew } = useOrdersRealtime({
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

  // ---------- Detail panel + flash highlight ----------
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
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
      setErrorBanner(t("bulkCancelError"));
      setTimeout(() => setErrorBanner(null), 4000);
    }
  }, [selectedIds, clearSelection, mutate, t]);

  // ---------- Filter patch helpers ----------
  const handleClearField = useCallback(
    (key: ClearableFilterKey) => setFilters(clearFilterField(filters, key)),
    [filters, setFilters],
  );
  const handleClearAll = useCallback(() => setFilters(resetFiltersFn(filters)), [filters, setFilters]);

  // ---------- Refresh ----------
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      // Give the icon rotation a visible beat
      setTimeout(() => setRefreshing(false), 600);
    }
  }, [mutate]);

  // ---------- Create modal ----------
  const [createOpen, setCreateOpen] = useState(false);

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

  const canAssign = isSuperAdmin || role === "market_manager";

  const activeMarketLabel = useMemo(() => {
    if (!isSuperAdmin) return userMarketLabel;
    if (!filters.marketId) return t("filters.allMarkets");
    return markets.find((m) => m.id === filters.marketId)?.name ?? "—";
  }, [isSuperAdmin, filters.marketId, markets, userMarketLabel, t]);

  return (
    <div
      style={{
        padding: "32px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("subtitle", { count: rows.length, market: activeMarketLabel })}
          {isValidating ? ` · ${t("refreshing")}` : ""}
        </p>
      </div>

      <OrdersFilterBar
        filters={filters}
        onChange={update}
        onOpenAdvanced={() => {
          setDrawerMounted(true);
          setDrawerOpen(true);
        }}
        onNewOrder={() => setCreateOpen(true)}
        onExport={handleExport}
        onRefresh={handleRefresh}
        isRefreshing={refreshing}
        isSuperAdmin={isSuperAdmin}
        markets={markets}
        agents={agents}
        lockedMarketLabel={userMarketLabel}
      />

      <OrdersFilterChips
        filters={filters}
        onClearField={handleClearField}
        onClearAll={handleClearAll}
        agentNameLookup={(id) => agents.find((a) => a.id === id)?.full_name ?? null}
        productNameLookup={(id) => productsData?.data.find((p) => p.id === id)?.name ?? null}
      />

      <div>
        <OrdersPresetPills
          active={filters.preset}
          onChange={(next) => update({ preset: next })}
        />
      </div>

      <NewOrdersBanner count={newCount} onReveal={revealNew} onDismiss={dismissNew} />

      {errorBanner ? (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "#FFF4F4",
            color: "#D72C0D",
            border: "1px solid #F3B9B0",
            fontSize: 13,
          }}
        >
          {errorBanner}
        </div>
      ) : null}

      <OrdersBulkBar
        selectedIds={Array.from(selectedIds)}
        agents={agents.filter((a) => a.is_active)}
        onClearSelection={clearSelection}
        onBulkAssign={handleBulkAssign}
        onBulkCancel={handleBulkCancel}
        canAssign={canAssign}
        canCancel={canAssign}
      />

      <OrdersTable
        rows={rows}
        locale={locale}
        currencyCode={currencyCode}
        agents={agents}
        selectedIds={selectedIds}
        highlightedIds={highlightedIds}
        cancellingId={cancellingId}
        hasNext={hasNext}
        hasPrev={hasPrev}
        currentPage={currentPage}
        onNextPage={nextPage}
        onPrevPage={prevPage}
        onOpen={(id) => {
          setOpenOrderId(id);
          flashRow(id);
        }}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onCancel={handleCancel}
        isLoading={isLoading}
        isEmpty={!isLoading && rows.length === 0}
      />

      <div style={{ fontSize: 13, color: "#6D7175", textAlign: "end" }}>
        {t("footerCount", { count: rows.length })}
        {hasNext ? ` · ${t("footerMore")}` : ""}
        {` · ${t("footerLive")}`}
      </div>

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
        />
      ) : null}

      <OrderDetailPanel
        key={openOrderId ?? "none"}
        orderId={openOrderId}
        fallbackOrder={fallbackOpenRow as unknown as Record<string, unknown> | null}
        onClose={() => setOpenOrderId(null)}
        onCallTerminated={() => setOpenOrderId(null)}
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
    </div>
  );
}

