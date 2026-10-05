"use client";

// Archivées — prototypes/commandes-v4.html, screen « Archivées »: putting
// finished orders away. The rule (« Ranger tout seul au bout de N jours »),
// four tabs (Prêtes à ranger · Déjà rangées · Encore récentes · Supprimées),
// the same search, dates, filters, rows and panel as Commandes. The analysis
// lives in Performance › Commandes; a door points there.

import "./commandes.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import type { Locale, Role } from "@/types";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { useOrdersFiltersUrl } from "@/hooks/useOrdersFiltersUrl";
import { useOrdersList, type OrdersListRow } from "@/hooks/useOrdersList";
import { ordersTopic, useOrdersRealtime } from "@/hooks/useOrdersRealtime";
import { useBroadcastConnected } from "@/components/providers/RealtimeProvider";
import { useRejectionBadge } from "@/hooks/useRejectionBadge";
import { useMaxCallAttempts } from "@/hooks/useMaxCallAttempts";
import { todayInMarket } from "@/lib/dates/market-day";
import { clearFilterField, filtersToSearchParams, hasActiveFilters, resetFilters, type ArchiveTab, type OrderListFilters } from "@/lib/orders/list-filters";
import type { FacetCounts } from "@/app/api/orders/facet-counts/route";
import { makeFmt } from "@/components/performance/orders/ui";
import { Ic, useTip, useWhen, type StoreInfo } from "./ui";
import { DateButton, useWindowLabel } from "./Dates";
import { Chips, FilterLine, type Agent, type Named } from "./FilterLine";
import { OrderList, type RowAction } from "./OrderList";
import { SearchBox } from "./SearchBox";
import { BulkBar } from "./BulkBar";

const OrderDetailPanel = dynamic(() => import("@/components/queue/OrderDetailPanel").then((m) => m.OrderDetailPanel), { ssr: false });

interface Market {
  id: string;
  name: string;
  currency?: string;
}

interface ArchiveCounts {
  eligible: number;
  archived: number;
  recent: number;
  deleted: number;
  finished: number;
  rule_days: number;
}

export interface ArchivePageProps {
  role: Role;
  userId: string;
  locale: Locale;
  userMarketId: string;
  userMarketLabel: string;
  userMarketCurrency: string;
  firstOrderDay: string | null;
}

const TABS: ArchiveTab[] = ["eligible", "archived", "recent", "deleted"];
const RULE_DAYS = [15, 30, 60, 90];

export function ArchivePage({ role, userId, locale, userMarketId, userMarketLabel, userMarketCurrency, firstOrderDay }: ArchivePageProps) {
  const t = useTranslations("commandes");
  const tS = useTranslations("orders.statuses");
  const router = useRouter();
  const isSuperAdmin = role === "super_admin";

  const { filters: raw, setFilters, update } = useOrdersFiltersUrl();
  const { scope, marketId: scopeMarketId } = useMarketScope();
  const filters: OrderListFilters = useMemo(
    () => ({ ...raw, scope: "archive", preset: "all", marketId: isSuperAdmin ? (scope === "all" ? null : scopeMarketId) : userMarketId }),
    [raw, isSuperAdmin, scope, scopeMarketId, userMarketId],
  );
  const marketId = filters.marketId;
  const tab = filters.archiveTab;

  const { data: marketsData } = useSWR<{ data: Market[] }>(isSuperAdmin ? "/api/markets" : null, fetcher);
  const markets = useMemo(() => marketsData?.data ?? [], [marketsData]);
  const { data: agentsData } = useSWR<{ data: Agent[] }>(marketId ? `/api/agents?market_id=${marketId}` : null, fetcher);
  const agents = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const { data: storesData } = useSWR<{ data: StoreInfo[] }>(marketId ? `/api/storefronts?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false });
  const stores = useMemo(() => storesData?.data ?? [], [storesData]);
  const { data: productsData } = useSWR<{ data: Named[] }>(marketId ? `/api/products?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false });
  const { data: carriersData } = useSWR<{ data: Named[] }>(marketId ? `/api/carriers?market_id=${marketId}` : null, fetcher, { revalidateOnFocus: false });

  const market = markets.find((m) => m.id === marketId);
  const f = useMemo(() => makeFmt(locale === "ar" ? "ar" : "fr", market?.currency ?? userMarketCurrency), [locale, market, userMarketCurrency]);
  const when = useWhen(marketId, locale);
  const today = todayInMarket(marketId);
  const marketLabel = isSuperAdmin ? (marketId ? market?.name ?? "—" : t("allMarkets")) : userMarketLabel;

  const realtimeIds = useMemo(() => (marketId ? [marketId] : markets.map((m) => m.id)), [marketId, markets]);
  const live = useBroadcastConnected(realtimeIds.map(ordersTopic));
  const list = useOrdersList({ filters, live });
  // A finished order changes rarely; patching in place is enough and the server revalidation prunes.
  const matchFilter = useCallback((row: OrdersListRow) => !marketId || row.market_id === marketId, [marketId]);
  useOrdersRealtime({ marketIds: realtimeIds, mutate: list.mutate, matchFilter });

  const countsKey = `/api/orders/archive/counts${marketId ? `?market_id=${marketId}` : ""}`;
  const { data: countsData, mutate: mutateCounts } = useSWR<{ data: ArchiveCounts }>(countsKey, fetcher, { revalidateOnFocus: false, keepPreviousData: true });
  const counts = countsData?.data;
  const facetKey = useMemo(() => {
    const q = filtersToSearchParams(filters);
    if (marketId) q.set("market_id", marketId);
    q.delete("limit");
    return `/api/orders/facet-counts?${q.toString()}`;
  }, [filters, marketId]);
  const { data: facetData } = useSWR<{ data: FacetCounts }>(facetKey, fetcher, { revalidateOnFocus: false, keepPreviousData: true });

  // ── the rule ──
  const [ruleOn, setRuleOn] = useState(true);
  const [ruleDays, setRuleDays] = useState(30);
  useEffect(() => {
    if (!counts) return;
    setRuleOn(counts.rule_days > 0);
    if (counts.rule_days > 0) setRuleDays(counts.rule_days);
  }, [counts]);

  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((c) => (c === m ? null : c)), 3200);
  }, []);
  const fail = useCallback((m: string) => {
    setError(m);
    window.setTimeout(() => setError((c) => (c === m ? null : c)), 5000);
  }, []);

  const saveRule = useCallback(
    async (on: boolean, days: number) => {
      if (!marketId) return;
      setRuleOn(on);
      setRuleDays(days);
      const res = await fetch(`/api/settings/${marketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_archive_after_days: on ? days : 0 }),
      });
      if (!res.ok) {
        fail(t("archive.ruleError"));
        void mutateCounts();
        return;
      }
      say(t("archive.ruleSaved"));
      void mutateCounts();
      void list.mutate();
    },
    [marketId, fail, say, t, mutateCounts, list],
  );

  // ── selection + actions ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [tab]);
  const toggle = useCallback((id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toggleAll = useCallback((ids: string[]) => setSelected((p) => (ids.every((id) => p.has(id)) ? new Set([...p].filter((id) => !ids.includes(id))) : new Set([...p, ...ids]))), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const { mutate: globalMutate } = useSWRConfig();
  const refresh = useCallback(async () => {
    await list.mutate();
    void mutateCounts();
    void globalMutate((k) => typeof k === "string" && k.startsWith("/api/orders/facet-counts"));
  }, [list, mutateCounts, globalMutate]);

  const act = useCallback(
    async (kind: "putaway" | "unarchive" | "restore", ids: string[]) => {
      if (!ids.length) return;
      if (kind === "restore") {
        const res = await fetch("/api/orders/bulk-recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_ids: ids }) });
        if (!res.ok) return fail(t("toast.error"));
        const body = await res.json().catch(() => null);
        const ok = body?.data?.restored?.length ?? 0;
        const ko = body?.data?.failed?.length ?? 0;
        if (ok) say(t("toast.restored", { n: ok }));
        if (ko) fail(t("toast.restoreFailed", { n: ko }));
      } else {
        const res = await fetch("/api/orders/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_ids: ids, action: kind === "putaway" ? "archive" : "unarchive" }),
        });
        if (!res.ok) return fail(t("toast.error"));
        const body = await res.json().catch(() => null);
        const n = body?.data?.archived ?? ids.length;
        say(kind === "putaway" ? t("toast.putaway", { n }) : t("toast.unarchived", { n }));
      }
      setSelected(new Set());
      await refresh();
    },
    [fail, say, t, refresh],
  );
  const tabAction = tab === "deleted" ? "restore" : tab === "archived" ? "unarchive" : "putaway";
  const tabActionWords = { restore: ["rotate", t("bulk.restore")], unarchive: ["rotate", t("bulk.unarchive")], putaway: ["archive", t("bulk.putaway")] } as const;

  const actionsFor = useCallback(
    (): RowAction[] => [
      { key: "open", icon: "ext", label: t("row.open") },
      { key: tabAction, icon: tabActionWords[tabAction][0], label: tab === "deleted" ? t("row.recover") : tabActionWords[tabAction][1] },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, t],
  );

  const maxAttempts = useMaxCallAttempts(marketId);
  const rejection = useRejectionBadge(marketId);
  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.full_name ?? null, [agents]);
  const storeOf = useCallback((id: string | null) => (id ? stores.find((s) => s.id === id) : undefined), [stores]);
  const statusLabel = useCallback((s: string) => (tS.has(s) ? tS(s) : s), [tS]);
  const windowLabel = useWindowLabel(f, today);
  const clearAll = useCallback(() => setFilters(resetFilters(filters)), [filters, setFilters]);
  const tip = useTip();
  const patch = useCallback((p: Partial<OrderListFilters>) => update(p), [update]);
  const fallbackOpen = useMemo(() => (openId ? list.rows.find((r) => r.id === openId) ?? null : null), [list.rows, openId]);

  const exportUrl = useMemo(() => {
    const q = filtersToSearchParams(filters);
    if (marketId) q.set("market_id", marketId);
    q.delete("limit");
    return `/api/orders/export?${q.toString()}`;
  }, [filters, marketId]);

  const hint =
    tab === "eligible"
      ? ruleOn
        ? t("archive.hints.eligibleAuto")
        : t("archive.hints.eligibleManual")
      : tab === "recent"
        ? t("archive.hints.recent", { n: ruleDays })
        : t(`archive.hints.${tab}`);

  return (
    <div className="cmd cmd-page" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        <header className="ph">
          <div>
            <h1>{t("archive.title")}</h1>
            <div className="sub">
              <span>{marketLabel}</span>
              <span className="sep" />
              <span>{t("archive.finished", { n: counts?.finished ?? 0 })}</span>
              <span className="sep" />
              <span>{t("archive.deleted", { n: counts?.deleted ?? 0 })}</span>
            </div>
          </div>
          <div className="acts">
            <a className="btn2" href={exportUrl}>
              <Ic n="download" />
              {t("archive.excel")}
            </a>
          </div>
        </header>

        <div className="rule">
          <span className="rl">
            <button
              type="button"
              className={`tog${ruleOn ? " on" : ""}`}
              role="switch"
              aria-checked={ruleOn}
              aria-label={t("archive.rule")}
              disabled={!marketId}
              onClick={() => void saveRule(!ruleOn, ruleDays)}
            />
            <b>{t("archive.rule")}</b>
            <span>{t("archive.after")}</span>
            <select value={ruleDays} disabled={!marketId} aria-label={t("archive.days")} onChange={(e) => void saveRule(ruleOn, Number(e.target.value))}>
              {[...new Set([...RULE_DAYS, ruleDays])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span>{t("archive.days")}</span>
          </span>
          <span className="rh">{t("archive.ruleHint")}</span>
          <button type="button" className="door" data-tip={t("archive.doorTip")} onClick={() => router.push(`/${locale}/performance/orders`)}>
            <Ic n="funnel" />
            {t("archive.door")}
            <Ic n="ext" className="flip" />
          </button>
        </div>

        <div className="seg-row">
          <div className="seg" role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => patch({ archiveTab: k, statuses: k === "deleted" ? [] : filters.statuses })}>
                {t(`archive.tabs.${k}`)}
                <em>{counts ? f.n(counts[k]) : "—"}</em>
              </button>
            ))}
          </div>
          <span className="hint">{hint}</span>
        </div>

        <div className="tools">
          <SearchBox value={filters.q} placeholder={t("search.archive")} onChange={(q) => patch({ q })} />
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
          cities={Object.keys(facetData?.data.cities ?? {}).filter((c) => c !== "none")}
          f={f}
          statusLabel={statusLabel}
        />
        <Chips
          filters={filters}
          tileLabel={null}
          dateLabel={filters.dateFrom || filters.dateTo ? windowLabel(filters.dateFrom, filters.dateTo) : null}
          statusLabel={statusLabel}
          agentName={(id) => agentName(id) ?? "—"}
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
          mode={tab}
          rows={list.rows}
          loading={list.isLoading}
          total={list.total}
          page={list.currentPage}
          pageSize={filters.pageSize}
          hasPrev={list.hasPrev}
          hasNext={list.hasNext}
          onPrev={() => (setSelected(new Set()), list.prevPage(), window.scrollTo(0, 0))}
          onNext={() => (setSelected(new Set()), list.nextPage(), window.scrollTo(0, 0))}
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
          slaMinutes={null}
          rejection={rejection}
          agentName={agentName}
          store={storeOf}
          actionsFor={actionsFor}
          agents={[]}
          onAction={(o, key) => (key === "open" ? setOpenId(o.id) : void act(tabAction, [o.id]))}
        />

        <BulkBar
          count={selected.size}
          buttons={[{ key: tabAction, icon: tabActionWords[tabAction][0], label: tabActionWords[tabAction][1] }]}
          onButton={() => void act(tabAction, [...selected])}
          onClear={() => setSelected(new Set())}
        />
      </div>

      <OrderDetailPanel
        key={openId ?? "none"}
        orderId={openId}
        fallbackOrder={fallbackOpen as unknown as Record<string, unknown> | null}
        role={role}
        userId={userId}
        onClose={() => setOpenId(null)}
        onOutcomeDone={() => void refresh()}
      />

      {toast && (
        <div className="tip on" role="status" style={{ left: "50%", top: 64, transform: "translateX(-50%)" }}>
          → {toast}
        </div>
      )}
      <div className="tip" ref={tip.ref} />
    </div>
  );
}
