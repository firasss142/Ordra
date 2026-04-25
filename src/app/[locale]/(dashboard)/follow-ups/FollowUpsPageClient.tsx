"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { FollowUpsFilterBar, type ViewMode } from "@/components/follow-ups/FollowUpsFilterBar";
import { FollowUpsKanban, type FollowUpsKanbanColumn } from "@/components/follow-ups/FollowUpsKanban";
import { FollowUpsTimeline } from "@/components/follow-ups/FollowUpsTimeline";
import { OverdueByAgentTable } from "@/components/follow-ups/OverdueByAgentTable";
import { NewFollowUpsBanner } from "@/components/follow-ups/NewFollowUpsBanner";
import { useFollowUpsColumn } from "@/hooks/useFollowUpsColumn";
import { useFollowUpsSummary } from "@/hooks/useFollowUpsSummary";
import { useFollowUpsRealtime } from "@/hooks/useFollowUpsRealtime";
import { useFollowUpsTimeline } from "@/hooks/useFollowUpsTimeline";
import { useStatusConfigs } from "@/hooks/useStatusConfigs";
import { getStatusLabel } from "@/lib/statuses/label";
import { fetcher } from "@/lib/swr-config";
import type { FollowUpsKanbanInitial, FollowUpsListPage } from "@/lib/follow-ups/list";
import type { FollowUpsSummary } from "@/lib/follow-ups/summary";
import type {
  FollowUpStatus,
  OrderFollowUpWithOrder,
} from "@/types/follow-up";
import type { Locale, Role } from "@/types";

const NewFollowUpModal = dynamic(
  () => import("@/components/follow-ups/NewFollowUpModal").then((m) => m.NewFollowUpModal),
  { ssr: false },
);

interface Market {
  id: string;
  name: string;
  code?: string;
}

interface Props {
  role: Role;
  userMarketId: string;
  userMarketLabel: string;
  locale: Locale;
  marketCode: "TN" | "LY";
  initialSummary: FollowUpsSummary;
  initialColumnPages: FollowUpsKanbanInitial;
  initialMarketId: string;
  initialTimelinePage: FollowUpsListPage;
  initialAgentId: string | null;
}

const STATUS_ORDER: FollowUpStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "escalated",
];

export function FollowUpsPageClient({
  role,
  userMarketId,
  userMarketLabel,
  locale,
  marketCode,
  initialSummary,
  initialColumnPages,
  initialMarketId,
  initialTimelinePage,
  initialAgentId,
}: Props) {
  const t = useTranslations("crm.followUps");
  const tStatuses = useTranslations("crm.followUps.statuses");

  const isSuperAdmin = role === "super_admin";
  const isManager = role === "market_manager" || role === "super_admin";
  const isAgent = role === "agent";

  const [selectedMarketId, setSelectedMarketId] = useState<string | "all">(
    isSuperAdmin ? (initialMarketId || "all") : userMarketId,
  );
  const effectiveMarketId =
    !isSuperAdmin || selectedMarketId === "all"
      ? isSuperAdmin
        ? null
        : userMarketId
      : selectedMarketId;

  const [statusFilter, setStatusFilter] = useState<FollowUpStatus | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [agentFilter, setAgentFilter] = useState<string | null>(initialAgentId);
  const [logAttemptTarget, setLogAttemptTarget] = useState<OrderFollowUpWithOrder | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<FollowUpStatus | undefined>(undefined);

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isSuperAdmin ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  const { summary, mutate: mutateSummary } = useFollowUpsSummary({
    marketId: effectiveMarketId,
    agentId: isAgent ? (initialAgentId ?? null) : null,
    campaignId: null,
    fallback: initialSummary,
  });

  const timeline = useFollowUpsTimeline({
    marketId: effectiveMarketId,
    agentId: agentFilter,
    campaignId: null,
    fallbackFirstPage: initialTimelinePage,
  });

  const openCol = useFollowUpsColumn({
    status: "open",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId: null,
    fallbackFirstPage: initialColumnPages.open,
  });
  const inProgressCol = useFollowUpsColumn({
    status: "in_progress",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId: null,
    fallbackFirstPage: initialColumnPages.in_progress,
  });
  const resolvedCol = useFollowUpsColumn({
    status: "resolved",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId: null,
    fallbackFirstPage: initialColumnPages.resolved,
  });
  const escalatedCol = useFollowUpsColumn({
    status: "escalated",
    marketId: effectiveMarketId,
    agentId: null,
    campaignId: null,
    fallbackFirstPage: initialColumnPages.escalated,
  });

  const columnData = {
    open: openCol,
    in_progress: inProgressCol,
    resolved: resolvedCol,
    escalated: escalatedCol,
  } as const;

  const { newCount, reveal, dismiss } = useFollowUpsRealtime({
    marketId: effectiveMarketId,
    columnMutators: {
      open: openCol.mutate,
      in_progress: inProgressCol.mutate,
      resolved: resolvedCol.mutate,
      escalated: escalatedCol.mutate,
    },
    mutateSummary,
    timelineMutator: timeline.mutate,
  });

  const handleOpenAddFor = useCallback((status: FollowUpStatus) => {
    setPendingStatus(status);
    setCreateOpen(true);
  }, []);

  const handleMove = useCallback(
    async (
      item: OrderFollowUpWithOrder,
      fromStatus: FollowUpStatus,
      toStatus: FollowUpStatus,
    ) => {
      columnData[fromStatus].mutate(
        (pages) => {
          if (!pages) return pages;
          return pages.map((p) => ({
            ...p,
            rows: p.rows.filter((r) => r.id !== item.id),
          }));
        },
        { revalidate: false },
      );
      columnData[toStatus].mutate(
        (pages) => {
          if (!pages || pages.length === 0) return pages;
          const [first, ...rest] = pages;
          if (first.rows.some((r) => r.id === item.id)) return pages;
          return [
            {
              ...first,
              rows: [{ ...item, status: toStatus }, ...first.rows],
            },
            ...rest,
          ];
        },
        { revalidate: false },
      );

      try {
        const res = await fetch(`/api/follow-ups/${item.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_status: toStatus }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? "Transition failed");
        }
        await Promise.all([
          columnData[fromStatus].mutate(),
          columnData[toStatus].mutate(),
          mutateSummary(),
        ]);
      } catch (err) {
        await Promise.all([
          columnData[fromStatus].mutate(),
          columnData[toStatus].mutate(),
        ]);
        throw err;
      }
    },
    [columnData, mutateSummary],
  );

  const visibleStatuses: FollowUpStatus[] =
    statusFilter === "all" ? STATUS_ORDER : [statusFilter];

  const { configs: statusConfigs } = useStatusConfigs({
    marketId: effectiveMarketId ?? userMarketId,
    scope: "follow_up",
  });
  const configByKey = useMemo(
    () => Object.fromEntries(statusConfigs.map((c) => [c.key, c])),
    [statusConfigs],
  );

  const kanbanColumns: FollowUpsKanbanColumn[] = visibleStatuses.map((s) => {
    const cfg = configByKey[s];
    return {
      status: s,
      label: cfg ? getStatusLabel(cfg, locale) : tStatuses(s),
      data: columnData[s],
      count: summary[s],
      ...(s !== "resolved" ? { onAdd: () => handleOpenAddFor(s) } : {}),
    };
  });

  const totalRows =
    openCol.rows.length +
    inProgressCol.rows.length +
    resolvedCol.rows.length +
    escalatedCol.rows.length;

  const activeMarketLabel = useMemo(() => {
    if (!isSuperAdmin) return userMarketLabel;
    if (selectedMarketId === "all" || !selectedMarketId) return t("allMarkets");
    return markets.find((m) => m.id === selectedMarketId)?.name ?? "—";
  }, [isSuperAdmin, selectedMarketId, markets, userMarketLabel, t]);

  const hasFilters = statusFilter !== "all";

  const handleReset = useCallback(() => {
    setStatusFilter("all");
  }, []);

  const effectiveViewMode: ViewMode = viewMode;

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
          {isAgent ? t("myDueToday") : t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("subtitle")} · {activeMarketLabel}
        </p>
      </div>

      <FollowUpsFilterBar
        markets={markets}
        selectedMarketId={selectedMarketId}
        onMarketChange={setSelectedMarketId}
        lockMarket={!isSuperAdmin}
        lockedMarketLabel={userMarketLabel}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        viewMode={effectiveViewMode}
        onViewModeChange={setViewMode}
        onReset={handleReset}
        onNewFollowUp={() => setCreateOpen(true)}
        hasActiveFilters={hasFilters}
      />

      {!isAgent && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <KpiCard label={t("metrics.total")} value={String(summary.total)} />
          <KpiCard label={t("metrics.open")} value={String(summary.open)} />
          <KpiCard label={t("metrics.inProgress")} value={String(summary.in_progress)} />
          <KpiCard
            label={t("metrics.resolved")}
            value={String(summary.resolved)}
            deltaTone="success"
          />
          <KpiCard
            label={t("metrics.escalated")}
            value={String(summary.escalated)}
            deltaTone="critical"
          />
        </div>
      )}

      <NewFollowUpsBanner count={newCount} onReveal={reveal} onDismiss={dismiss} />

      {effectiveViewMode === "timeline" ? (
        <>
          {isManager && (
            <OverdueByAgentTable
              marketId={effectiveMarketId}
              onSelectAgent={(aid) => setAgentFilter(agentFilter === aid ? null : aid)}
            />
          )}
          <FollowUpsTimeline
            rows={timeline.rows}
            hasMore={timeline.hasMore}
            loadingMore={timeline.loadingMore}
            onLoadMore={timeline.loadMore}
            marketCode={marketCode}
            locale={locale}
            onLogAttempt={setLogAttemptTarget}
          />
        </>
      ) : (
        <>
          <FollowUpsKanban
            columns={kanbanColumns}
            marketCode={marketCode}
            locale={locale}
            onMove={handleMove}
          />
          <div style={{ fontSize: 13, color: "#6D7175", textAlign: "end" }}>
            {t("footerCount", { count: totalRows })}
          </div>
        </>
      )}

      {createOpen && (
        <NewFollowUpModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setPendingStatus(undefined);
          }}
          onCreated={() => {
            setCreateOpen(false);
            const targetCol = pendingStatus ? columnData[pendingStatus] : openCol;
            setPendingStatus(undefined);
            void Promise.all([targetCol.mutate(), timeline.mutate(), mutateSummary()]);
          }}
          marketId={userMarketId}
          marketCode={marketCode}
          initialStatus={pendingStatus}
        />
      )}

      {logAttemptTarget && (
        <LogAttemptModal
          followUp={logAttemptTarget}
          onClose={() => setLogAttemptTarget(null)}
          onSubmitted={() => {
            setLogAttemptTarget(null);
            void timeline.mutate();
          }}
        />
      )}
    </div>
  );
}

function LogAttemptModal({
  followUp,
  onClose,
  onSubmitted,
}: {
  followUp: OrderFollowUpWithOrder;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const t = useTranslations("crm.followUps");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!note.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/follow-ups/${followUp.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "error");
      }
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 8,
          padding: 24,
          width: 400,
          maxWidth: "90vw",
        }}
      >
        <strong style={{ fontSize: 15, color: "#1A1A1A", display: "block", marginBottom: 4 }}>
          {t("logAttempt")}
        </strong>
        <div style={{ fontSize: 13, color: "#6D7175", marginBottom: 12 }}>
          {followUp.order.customer_name} · {followUp.order.customer_phone}
        </div>
        {err && (
          <div style={{ color: "#991B1B", fontSize: 13, marginBottom: 8 }}>{err}</div>
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("addNotePlaceholder")}
          autoFocus
          style={{
            width: "100%",
            height: 80,
            padding: "8px 10px",
            fontSize: 14,
            border: "1px solid #D1D5DB",
            borderRadius: 6,
            resize: "vertical",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 6,
              border: "1px solid #D1D5DB",
              background: "white",
              color: "#1A1A1A",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || !note.trim()}
            onClick={submit}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 6,
              border: "none",
              background: submitting || !note.trim() ? "#9CA3AF" : "#1A1A1A",
              color: "white",
              fontSize: 13,
              cursor: submitting || !note.trim() ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? t("adding") : t("addNote")}
          </button>
        </div>
      </div>
    </div>
  );
}
