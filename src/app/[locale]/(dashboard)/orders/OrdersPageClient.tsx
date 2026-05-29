"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useIsMobile } from "@/hooks/useIsMobile";
import useSWR from "swr";
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
import { OrdersFilterBar } from "@/components/orders/OrdersFilterBar";
import { OrdersFilterChips } from "@/components/orders/OrdersFilterChips";
import { OrdersPresetPills } from "@/components/orders/OrdersPresetPills";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { OrdersBulkBar } from "@/components/orders/OrdersBulkBar";
import { NewOrdersBanner } from "@/components/orders/NewOrdersBanner";
import { OrdersStatusStrip } from "@/components/orders/OrdersStatusStrip";
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

  const canAssign = isSuperAdmin || role === "market_manager";
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );
  const hasBulkDeleteIneligible = selectedRows.some(
    (row) => !canManuallyDeleteOrderStatus(row.status),
  );

  const activeMarketLabel = useMemo(() => {
    if (!isSuperAdmin) return userMarketLabel;
    if (!filters.marketId) return t("filters.allMarkets");
    return markets.find((m) => m.id === filters.marketId)?.name ?? "—";
  }, [isSuperAdmin, filters.marketId, markets, userMarketLabel, t]);

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

  return (
    <div
      style={{
        padding: isMobile ? "64px 16px 80px" : "24px 24px 80px",
        background: "#F6F6F7",
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
            <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
              {t("title")}
            </h1>
            <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
              {activeMarketLabel}
              {isValidating ? ` · ${t("refreshing")}` : ""}
            </p>
          </div>
        </div>

        <OrdersStatusStrip marketId={effectiveMarketId} />

        <OrdersPresetPills
          active={filters.preset}
          onChange={(next) => update({ preset: next })}
        />
      </div>

      {/* ── Filter card ── */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <OrdersFilterBar
          filters={filters}
          onChange={update}
          onOpenAdvanced={() => {
            setDrawerMounted(true);
            setDrawerOpen(true);
          }}
          onNewOrder={() => setCreateOpen(true)}
          onExport={handleExport}
          marketLabel={activeMarketLabel}
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

      {/* ── Orders table wrapped in card ── */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
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
          onDuplicateChange={() => void mutate()}
          isLoading={isLoading}
          isEmpty={!isLoading && rows.length === 0}
        />
      </div>

      <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: "end" }}>
        {t("footerLive")}
      </div>

      {/* ── Bulk action bar (fixed bottom, rendered via portal-like position:fixed) ── */}
      <OrdersBulkBar
        selectedIds={Array.from(selectedIds)}
        agents={agents.filter((a) => a.is_active)}
        onClearSelection={clearSelection}
        onBulkAssign={handleBulkAssign}
        onBulkCancel={handleBulkCancel}
        canAssign={canAssign}
        canCancel={canAssign}
        cancelDisabled={hasBulkDeleteIneligible}
        cancelDisabledReason={t("bulk.cancelIneligible")}
      />

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

