"use client";

// Commandes — prototypes/commandes-v4.html, screen « Commandes ».
// Header · four work shortcuts counted now · search + dates · one calm line of
// filters · the list · the bulk bar. The order panel and « Nouvelle commande »
// are their own components; this page opens them.

import "./commandes.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import type { Locale, Role } from "@/types";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { useOrdersFiltersUrl } from "@/hooks/useOrdersFiltersUrl";
import { useOrdersList, type OrdersListPage, type OrdersListRow } from "@/hooks/useOrdersList";
import { ordersTopic, useOrdersRealtime } from "@/hooks/useOrdersRealtime";
import { useBroadcastConnected } from "@/components/providers/RealtimeProvider";
import { useOrderLocks } from "@/hooks/useOrderLocks";
import { useRejectionBadge } from "@/hooks/useRejectionBadge";
import { useMaxCallAttempts } from "@/hooks/useMaxCallAttempts";
import { useSlaMinutes } from "@/hooks/useSlaMinutes";
import { useSettledValue } from "@/hooks/useSettledValue";
import { readActionFailure } from "@/lib/orders/action-failure";
import type { OrderLockInfo } from "@/lib/orders/order-lock";
import { OrderLockedDialog } from "@/components/orders/OrderLockedDialog";
import { BulkUploadPanel } from "@/components/orders/BulkUploadPanel";
import { BulkReopenPanel } from "@/components/orders/BulkReopenPanel";
import { marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import {
  RECALL_STATUSES,
  UNASSIGNED,
  clearFilterField,
  filtersToSearchParams,
  hasActiveFilters,
  resetFilters,
  type OrderListFilters,
  type OrdersPreset,
} from "@/lib/orders/list-filters";
import { CALLING_STATUSES } from "@/lib/orders/row-signals";
import type { WorkCounts } from "@/app/api/orders/status-counts/route";
import type { FacetCounts } from "@/app/api/orders/facet-counts/route";
import { makeFmt } from "@/components/performance/orders/ui";
import { Ic, marketParts, useTip, useWhen, type StoreInfo } from "./ui";
import { DateButton, useWindowLabel } from "./Dates";
import { Chips, FilterLine, type Agent, type Named } from "./FilterLine";
import { OrderList, type RowAction } from "./OrderList";
import { SearchBox } from "./SearchBox";
import { BulkBar } from "./BulkBar";

const OrderDetailPanel = dynamic(() => import("@/components/queue/OrderDetailPanel").then((m) => m.OrderDetailPanel), { ssr: false });
const CreateOrderModal = dynamic(() => import("@/components/orders/CreateOrderModal").then((m) => m.CreateOrderModal), { ssr: false });
const PostCallActionSheet = dynamic(() => import("@/components/queue/PostCallActionSheet").then((m) => m.PostCallActionSheet), { ssr: false });

interface Market {
  id: string;
  name: string;
  code: string;
  currency?: string;
}

export interface CommandesPageProps {
  role: Role;
  userId: string;
  userMarketId: string;
  userMarketLabel: string;
  userMarketCurrency: string;
  locale: Locale;
  fallbackFirstPage: OrdersListPage;
  initialMarketId: string;
  fallbackAgents: Agent[];
  /** The market's first order day, for « Toutes les dates · depuis le … ». */
  firstOrderDay: string | null;
}

const TILES: { k: Exclude<OrdersPreset, "all">; icon: string; hue: string }[] = [
  { k: "today", icon: "cal", hue: "neutral" },
  { k: "unassigned", icon: "user", hue: "amber" },
  { k: "recall", icon: "phone", hue: "violet" },
  { k: "uploaded_today", icon: "upload", hue: "teal" },
];

const COUNT_OF: Record<(typeof TILES)[number]["k"], keyof WorkCounts> = {
  today: "today",
  unassigned: "unassigned",
  recall: "recall",
  uploaded_today: "uploadedToday",
};

export function CommandesPage(props: CommandesPageProps) {
  const { role, userId, userMarketId, userMarketLabel, userMarketCurrency, locale, fallbackFirstPage, initialMarketId, fallbackAgents, firstOrderDay } = props;
  const t = useTranslations("commandes");
  const tS = useTranslations("orders.statuses");
  const router = useRouter();
  const isSuperAdmin = role === "super_admin";
  const canManage = isSuperAdmin || role === "market_manager";

  // ── filters (URL) ──
  const { filters: raw, setFilters, update } = useOrdersFiltersUrl();
  const { scope, marketId: scopeMarketId } = useMarketScope();
  const filters: OrderListFilters = useMemo(
    () => ({ ...raw, scope: "orders", marketId: isSuperAdmin ? (scope === "all" ? null : scopeMarketId) : userMarketId }),
    [raw, isSuperAdmin, scope, scopeMarketId, userMarketId],
  );
  const marketId = filters.marketId;
  const patch = useCallback((p: Partial<OrderListFilters>) => update(p), [update]);

  // ── reference data ──
  const { data: marketsData } = useSWR<{ data: Market[] }>(isSuperAdmin ? "/api/markets" : null, fetcher);
  const markets = useMemo(() => marketsData?.data ?? [], [marketsData]);
  const agentsFallback = useMemo(() => (fallbackAgents.length ? { data: fallbackAgents } : undefined), [fallbackAgents]);
  const { data: agentsData } = useSWR<{ data: Agent[] }>(marketId ? `/api/agents?market_id=${marketId}` : null, fetcher, { fallbackData: agentsFallback });
  const agents = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const activeAgents = useMemo(() => agents.filter((a) => a.is_active !== false), [agents]);
  const { data: storesData } = useSWR<{ data: StoreInfo[] }>(marketId ? `/api/storefronts?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false });
  const stores = useMemo(() => storesData?.data ?? [], [storesData]);
  const { data: productsData } = useSWR<{ data: Named[] }>(marketId ? `/api/products?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false });
  const { data: carriersData } = useSWR<{ data: Named[] }>(marketId ? `/api/carriers?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false });
  const { data: citiesData } = useSWR<{ data: { name: string }[] }>(marketId ? `/api/cities?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });
  // Warm the add-product picker the panel opens.
  useSWR(marketId ? `/api/products/search?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false, dedupingInterval: 60_000 });

  const market = markets.find((m) => m.id === marketId);
  const currency = market?.currency ?? userMarketCurrency;
  const f = useMemo(() => makeFmt(locale === "ar" ? "ar" : "fr", currency), [locale, currency]);
  const when = useWhen(marketId, locale);
  const today = todayInMarket(marketId);
  const marketLabel = isSuperAdmin ? (marketId ? market?.name ?? "—" : t("allMarkets")) : userMarketLabel;

  // ── the list ──
  const realtimeIds = useMemo(() => (marketId ? [marketId] : markets.map((m) => m.id)), [marketId, markets]);
  const live = useBroadcastConnected(realtimeIds.map(ordersTopic));
  const list = useOrdersList({
    filters,
    fallbackFirstPage: !hasActiveFilters(filters) && (isSuperAdmin ? marketId === initialMarketId : true) ? fallbackFirstPage : undefined,
    live,
  });
  const dayStart = useMemo(() => marketDayStartUtc(today, marketId), [today, marketId]);
  const matchFilter = useCallback(
    (row: OrdersListRow) => {
      if (marketId && row.market_id !== marketId) return false;
      if (row.status === "deleted" || row.archived_at) return false;
      if (filters.preset === "unassigned") return row.status === "pending" && row.assigned_to === null;
      if (filters.preset === "recall") return (RECALL_STATUSES as readonly string[]).includes(row.status);
      if (filters.preset === "today") return !!dayStart && row.created_at >= dayStart;
      if (filters.statuses.length && !filters.statuses.includes(row.status as never)) return false;
      if (filters.agentIds.length) {
        const k = row.assigned_to ?? UNASSIGNED;
        if (!filters.agentIds.includes(k)) return false;
      }
      return true;
    },
    [marketId, filters.preset, filters.statuses, filters.agentIds, dayStart],
  );
  useOrdersRealtime({ marketIds: realtimeIds, mutate: list.mutate, matchFilter });

  // ── shortcuts + facet counts ──
  const countsKey = `/api/orders/status-counts${marketId ? `?market_id=${marketId}` : ""}`;
  const { data: countsData } = useSWR<{ data: WorkCounts }>(countsKey, fetcher, { refreshInterval: 60_000, revalidateOnFocus: false, keepPreviousData: true });
  const counts = countsData?.data;
  const rawFacetKey = useMemo(() => {
    const q = filtersToSearchParams(filters);
    if (marketId) q.set("market_id", marketId);
    q.delete("limit");
    return `/api/orders/facet-counts?${q.toString()}`;
  }, [filters, marketId]);
  const facetKey = useSettledValue(rawFacetKey, 500);
  const { data: facetData } = useSWR<{ data: FacetCounts }>(facetKey, fetcher, { revalidateOnFocus: false, keepPreviousData: true, dedupingInterval: 5_000 });

  const cityNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of citiesData?.data ?? []) if (c.name) set.add(c.name);
    for (const k of Object.keys(facetData?.data.cities ?? {})) if (k !== "none") set.add(k);
    return [...set];
  }, [citiesData, facetData]);

  // ── per-row helpers ──
  const maxAttempts = useMaxCallAttempts(marketId);
  const slaMinutes = useSlaMinutes(marketId);
  const rejection = useRejectionBadge(marketId);
  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.full_name ?? null, [agents]);
  const storeOf = useCallback((id: string | null) => (id ? stores.find((s) => s.id === id) : undefined), [stores]);
  const statusLabel = useCallback(
    (s: string) => (s.startsWith("attempt_") ? t("status.attempt", { n: Number(s.slice(8)), max: maxAttempts ?? 3 }) : tS.has(s) ? tS(s) : s),
    [t, tS, maxAttempts],
  );
  const { othersOn, refresh: refreshLocks } = useOrderLocks({ marketId: marketId ?? userMarketId ?? null, enabled: canManage, selfId: userId });
  const isHere = useCallback((row: OrdersListRow) => othersOn(row.id).some((r) => r.user_id === row.assigned_to), [othersOn]);

  // ── selection ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const visible = new Set(list.rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [list.rows]);
  const toggle = useCallback((id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toggleAll = useCallback((ids: string[]) => setSelected((p) => (ids.every((id) => p.has(id)) ? new Set([...p].filter((id) => !ids.includes(id))) : new Set([...p, ...ids]))), []);
  const clearSel = useCallback(() => setSelected(new Set()), []);

  // ── the panel, deep-linkable with ?open= ──
  const searchParams = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(() => searchParams?.get("open") ?? null);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openId ? url.searchParams.get("open") === openId : !url.searchParams.has("open")) return;
    if (openId) url.searchParams.set("open", openId);
    else url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [openId]);
  const fallbackOpen = useMemo(() => (openId ? list.rows.find((r) => r.id === openId) ?? null : null), [list.rows, openId]);
  useEffect(() => {
    void import("@/components/queue/OrderDetailPanel");
  }, []);

  // ── feedback: one toast line, one error line, the lock dialog ──
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3200);
  }, []);
  const fail = useCallback((msg: string) => {
    setError(msg);
    window.setTimeout(() => setError((cur) => (cur === msg ? null : cur)), 5000);
  }, []);
  const [locked, setLocked] = useState<OrderLockInfo | null>(null);
  const { mutate: globalMutate } = useSWRConfig();
  const refresh = useCallback(async () => {
    await list.mutate();
    void globalMutate((k) => typeof k === "string" && (k.startsWith("/api/orders/status-counts") || k.startsWith("/api/orders/facet-counts")));
  }, [list, globalMutate]);
  const report = useCallback(
    async (res: Response) => {
      const body = await res.json().catch(() => null);
      const failure = readActionFailure(res.status, body);
      if (failure.conflict) await list.mutate();
      if (failure.locked) {
        setLocked(failure.locked);
        void refreshLocks();
        return;
      }
      fail(failure.message ?? t("toast.error"));
    },
    [list, refreshLocks, fail, t],
  );

  // ── actions ──
  const [uploadIds, setUploadIds] = useState<string[] | null>(null);
  const [reopenIds, setReopenIds] = useState<string[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [callSheet, setCallSheet] = useState<{ orderId: string; status: string; marketId: string; attemptsCount: number } | null>(null);

  const assignOne = useCallback(
    async (id: string, agentId: string | null) => {
      const res = await fetch(`/api/orders/${id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId }) });
      if (!res.ok) return report(res);
      await refresh();
      say(agentId ? t("toast.assigned", { n: 1, name: agentName(agentId) ?? "" }) : t("toast.pooled", { n: 1 }));
    },
    [report, refresh, say, t, agentName],
  );

  const bulkAssign = useCallback(
    async (agentId: string | null) => {
      const ids = [...selected];
      if (!agentId) {
        const results = await Promise.all(ids.map((id) => fetch(`/api/orders/${id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: null }) })));
        const ok = results.filter((r) => r.ok).length;
        clearSel();
        await refresh();
        if (ok < ids.length) fail(t("toast.error"));
        if (ok) say(t("toast.pooled", { n: ok }));
        return;
      }
      const res = await fetch("/api/orders/bulk-assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_ids: ids, agent_id: agentId }) });
      if (!res.ok) return report(res);
      const body = await res.json().catch(() => null);
      const lockedN = body?.data?.locked?.length ?? 0;
      clearSel();
      await refresh();
      void refreshLocks();
      if (lockedN) fail(t("toast.assignPartial", { assigned: body?.data?.assigned ?? 0, locked: lockedN }));
      else say(t("toast.assigned", { n: ids.length, name: agentName(agentId) ?? "" }));
    },
    [selected, clearSel, refresh, refreshLocks, report, fail, say, t, agentName],
  );

  const cancelOne = useCallback(
    async (id: string) => {
      const note = window.prompt(t("toast.cancelPrompt"));
      if (note === null) return;
      const res = await fetch(`/api/orders/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: note.trim() || "Force cancel" }) });
      if (!res.ok) return report(res);
      await refresh();
    },
    [report, refresh, t],
  );

  const selectedRows = useMemo(() => list.rows.filter((r) => selected.has(r.id)), [list.rows, selected]);
  const cancellable = (s: string) => CALLING_STATUSES.has(s) || s === "confirmed" || s === "dispatch_scheduled";
  const bulkCancel = useCallback(async () => {
    if (!window.confirm(t("toast.cancelConfirm", { n: selected.size }))) return;
    const res = await fetch("/api/orders/bulk-cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_ids: [...selected] }) });
    if (!res.ok) return report(res);
    clearSel();
    await refresh();
  }, [selected, report, clearSel, refresh, t]);

  const actionsFor = useCallback(
    (o: OrdersListRow): RowAction[] => {
      const a: RowAction[] = [{ key: "open", icon: "ext", label: t("row.open") }];
      if (!canManage) return a;
      a.push({ key: "assign", icon: "user", label: t("row.assign"), agents: true });
      if (o.status === "uploaded") a.push({ key: "reopen", icon: "rotate", label: t("row.reopen") });
      else if (cancellable(o.status)) a.push({ key: "cancel", icon: "trash", label: t("row.cancel"), neg: true });
      return a;
    },
    [canManage, t],
  );
  const onAction = useCallback(
    (o: OrdersListRow, key: string, agentId?: string | null) => {
      if (key === "open") setOpenId(o.id);
      else if (key === "assign") void assignOne(o.id, agentId ?? null);
      else if (key === "cancel") void cancelOne(o.id);
      else if (key === "reopen") setReopenIds([o.id]);
    },
    [assignOne, cancelOne],
  );

  // ── export, filters ──
  const exportCsv = useCallback(() => {
    const q = filtersToSearchParams(filters);
    if (marketId) q.set("market_id", marketId);
    window.location.href = `/api/orders/export?${q.toString()}`;
  }, [filters, marketId]);
  const windowLabel = useWindowLabel(f, today);
  const clearAll = useCallback(() => setFilters(resetFilters(filters)), [filters, setFilters]);
  const tip = useTip();

  const tileHint = (k: (typeof TILES)[number]["k"], n: number) => {
    if (k === "today") return t("tiles.todayHint", { time: marketParts(new Date().toISOString(), marketId).time });
    if (k === "unassigned") return n ? t("tiles.unassignedHint") : t("tiles.unassignedNone");
    if (k === "recall") return counts?.lateCallbacks ? <em>{t("tiles.recallLate", { n: counts.lateCallbacks })}</em> : t("tiles.recallHint");
    return counts?.toSend ? <em>{t("tiles.toSend", { n: counts.toSend })}</em> : t("tiles.uploadedHint");
  };

  return (
    <div className="cmd cmd-page" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        <header className="ph">
          <div>
            <h1>{t("title")}</h1>
            <div className="sub">
              <span>{marketLabel}</span>
              <span className="sep" />
              {live ? (
                <span className="live" data-tip={t("liveTip")}>
                  <i />
                  {t("live")}
                </span>
              ) : (
                <span className="q">{t("reconnecting")}</span>
              )}
            </div>
          </div>
          <div className="acts">
            <button type="button" className="btn2" onClick={exportCsv}>
              <Ic n="download" />
              {t("export")}
            </button>
            <button type="button" className="btn" onClick={() => setCreateOpen(true)}>
              <Ic n="plus" />
              {t("newOrder")}
            </button>
          </div>
        </header>

        <section className="wts" aria-label={t("tiles.aria")}>
          {TILES.map((T) => {
            const n = counts ? counts[COUNT_OF[T.k]] : null;
            const on = filters.preset === T.k;
            return (
              <button
                key={T.k}
                type="button"
                className={`wt h-${T.hue}${on ? " on" : ""}${n ? "" : " zero"}`}
                aria-pressed={on}
                onClick={() => {
                  clearSel();
                  patch({ preset: on ? "all" : T.k });
                }}
              >
                <span className="hold">
                  <Ic n={T.icon} />
                </span>
                <span className="wt-t">
                  <b>{n == null ? "—" : f.n(n)}</b>
                  <span>{t(`tiles.${T.k}`)}</span>
                  <small>{tileHint(T.k, n ?? 0)}</small>
                </span>
                {on && (
                  <span className="wt-x" aria-label={t("tiles.clear")}>
                    <Ic n="x" />
                  </span>
                )}
              </button>
            );
          })}
        </section>

        <div className="tools">
          <SearchBox value={filters.q} placeholder={t("search.list")} onChange={(q) => patch({ q })} />
          <DateButton from={filters.dateFrom} to={filters.dateTo} today={today} first={firstOrderDay} f={f} onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })} />
        </div>

        <FilterLine
          filters={filters}
          update={patch}
          counts={facetData?.data}
          total={list.total}
          agents={agents}
          stores={stores}
          products={productsData?.data ?? []}
          carriers={carriersData?.data ?? []}
          cities={cityNames}
          f={f}
          statusLabel={statusLabel}
          onGotoDeleted={() => router.push(`/${locale}/orders/archive?state=deleted`)}
        />
        <Chips
          filters={filters}
          tileLabel={filters.preset !== "all" ? t(`tiles.${filters.preset}`) : null}
          dateLabel={filters.dateFrom || filters.dateTo ? windowLabel(filters.dateFrom, filters.dateTo) : null}
          statusLabel={statusLabel}
          agentName={(id) => (id === UNASSIGNED ? t("row.unassigned") : agentName(id) ?? "—")}
          storeName={(id) => storeOf(id)?.name ?? "—"}
          productName={(id) => productsData?.data.find((p) => p.id === id)?.name ?? "—"}
          carrierName={(id) => carriersData?.data.find((c) => c.id === id)?.name ?? "—"}
          onClear={(k) => setFilters(clearFilterField(filters, k))}
          onClearAll={clearAll}
        />

        {error && (
          <div className="err" role="alert">
            {error}
          </div>
        )}

        <OrderList
          mode="list"
          rows={list.rows}
          loading={list.isLoading}
          total={list.total}
          page={list.currentPage}
          pageSize={filters.pageSize}
          hasPrev={list.hasPrev}
          hasNext={list.hasNext}
          onPrev={() => (clearSel(), list.prevPage(), window.scrollTo(0, 0))}
          onNext={() => (clearSel(), list.nextPage(), window.scrollTo(0, 0))}
          onPageSize={(pageSize) => patch({ pageSize })}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          openId={openId}
          onOpen={setOpenId}
          hasFilters={hasActiveFilters(filters)}
          onClearAll={clearAll}
          f={f}
          when={when}
          maxAttempts={maxAttempts}
          slaMinutes={slaMinutes}
          rejection={rejection}
          agentName={agentName}
          store={storeOf}
          isHere={canManage ? isHere : undefined}
          actionsFor={actionsFor}
          agents={activeAgents}
          onAction={onAction}
        />

        {canManage && (
          <BulkBar
            count={selected.size}
            agents={activeAgents}
            onAssign={(id) => void bulkAssign(id)}
            buttons={[
              { key: "send", icon: "truck", label: t("bulk.send") },
              { key: "reopen", icon: "rotate", label: t("bulk.reopen"), disabled: !selectedRows.some((r) => r.status === "uploaded") },
              { key: "cancel", icon: "trash", label: t("bulk.cancel"), neg: true, disabled: selectedRows.some((r) => !cancellable(r.status)), tip: selectedRows.some((r) => !cancellable(r.status)) ? t("bulk.cancelIneligible") : undefined },
            ]}
            onButton={(k) => {
              if (k === "send") setUploadIds([...selected]);
              else if (k === "reopen") setReopenIds([...selected]);
              else if (k === "cancel") void bulkCancel();
            }}
            onClear={clearSel}
          />
        )}
      </div>

      {uploadIds && (
        <BulkUploadPanel
          selectedIds={uploadIds}
          marketId={marketId}
          onClose={() => setUploadIds(null)}
          onDone={() => {
            clearSel();
            void refresh();
          }}
        />
      )}
      {reopenIds && (
        <BulkReopenPanel
          selectedIds={reopenIds}
          eligibleCount={list.rows.filter((r) => reopenIds.includes(r.id) && r.status === "uploaded").length}
          onClose={() => setReopenIds(null)}
          onDone={() => {
            clearSel();
            void refresh();
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
          void refresh();
        }}
      />

      <OrderLockedDialog open={locked !== null} lock={locked} role={role} onClose={() => setLocked(null)} onForceRelease={
        isSuperAdmin && locked
          ? async () => {
              await fetch(`/api/orders/${locked.order_id}/presence/force-release`, { method: "POST" });
              setLocked(null);
              await refreshLocks();
              await list.mutate();
            }
          : undefined
      } />

      <OrderDetailPanel
        key={openId ?? "none"}
        orderId={openId}
        fallbackOrder={fallbackOpen as unknown as Record<string, unknown> | null}
        role={role}
        userId={userId}
        onClose={() => setOpenId(null)}
        onCallTerminated={(_id, ctx) => {
          setOpenId(null);
          if (ctx) setCallSheet(ctx);
          void refresh();
        }}
        onReturnToPool={
          openId
            ? async () => {
                await fetch(`/api/orders/${openId}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: null }) });
                setOpenId(null);
                void refresh();
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
            void refresh();
          }}
        />
      )}

      {toast && (
        <div className="tip on" role="status" style={{ left: "50%", top: 64, transform: "translateX(-50%)" }}>
          → {toast}
        </div>
      )}
      <div className="tip" ref={tip.ref} />
    </div>
  );
}

