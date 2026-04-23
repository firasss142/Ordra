"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { FollowUpsFilterBar } from "@/components/follow-ups/FollowUpsFilterBar";
import { FollowUpsKanban, type FollowUpsKanbanColumn } from "@/components/follow-ups/FollowUpsKanban";
import { NewFollowUpsBanner } from "@/components/follow-ups/NewFollowUpsBanner";
import { useFollowUpsColumn } from "@/hooks/useFollowUpsColumn";
import { useFollowUpsSummary } from "@/hooks/useFollowUpsSummary";
import { useFollowUpsRealtime } from "@/hooks/useFollowUpsRealtime";
import { useStatusConfigs } from "@/hooks/useStatusConfigs";
import { getStatusLabel } from "@/lib/statuses/label";
import { fetcher } from "@/lib/swr-config";
import type { FollowUpsKanbanInitial } from "@/lib/follow-ups/list";
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
}: Props) {
  const t = useTranslations("crm.followUps");
  const tStatuses = useTranslations("crm.followUps.statuses");

  const isSuperAdmin = role === "super_admin";
  const isManager = role === "market_manager" || role === "super_admin";

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

  // ---------- Modals ----------
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<FollowUpStatus | undefined>(undefined);

  // ---------- Lazy markets load (super_admin only) ----------
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isSuperAdmin ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  // ---------- Summary ----------
  const { summary, mutate: mutateSummary } = useFollowUpsSummary({
    marketId: effectiveMarketId,
    agentId: null,
    campaignId: null,
    fallback: initialSummary,
  });

  // One hook per status — React requires a fixed number of hook calls per
  // render, so we spell them out rather than looping. The `columnData` map
  // is the stable structure downstream code walks.
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
      // Optimistic: remove from source column, prepend to destination.
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
        // Revalidate both columns to resync with the server-authoritative state.
        await Promise.all([
          columnData[fromStatus].mutate(),
          columnData[toStatus].mutate(),
          mutateSummary(),
        ]);
      } catch (err) {
        // Roll back: revalidate to restore truth.
        await Promise.all([
          columnData[fromStatus].mutate(),
          columnData[toStatus].mutate(),
        ]);
        throw err;
      }
    },
    [columnData, mutateSummary],
  );

  // ---------- Derived ----------
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
        onReset={handleReset}
        onNewFollowUp={() => setCreateOpen(true)}
        hasActiveFilters={hasFilters}
      />

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

      <NewFollowUpsBanner count={newCount} onReveal={reveal} onDismiss={dismiss} />

      <FollowUpsKanban
        columns={kanbanColumns}
        marketCode={marketCode}
        locale={locale}
        onMove={handleMove}
      />

      <div style={{ fontSize: 13, color: "#6D7175", textAlign: "end" }}>
        {t("footerCount", { count: totalRows })}
      </div>

      {createOpen && (
        <NewFollowUpModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setPendingStatus(undefined);
          }}
          onCreated={() => {
            setCreateOpen(false);
            // New follow-ups always land in "open"; if an initial_status
            // override transitioned it, realtime picks up the UPDATE.
            const targetCol = pendingStatus ? columnData[pendingStatus] : openCol;
            setPendingStatus(undefined);
            void Promise.all([targetCol.mutate(), mutateSummary()]);
          }}
          marketId={userMarketId}
          marketCode={marketCode}
          initialStatus={pendingStatus}
        />
      )}

    </div>
  );
}
